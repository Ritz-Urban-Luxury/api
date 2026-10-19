import {
  BadRequestException,
  CACHE_MANAGER,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Cache } from 'cache-manager';
import { isMongoId } from 'class-validator';
import { FilterQuery, Types, isValidObjectId } from 'mongoose';
import {
  RentalBillingType,
  RentalDocument,
  RentalStatus,
} from 'src/database/schemas/rentals.schema';
import {
  getPlayReviewAccount,
  getPlayReviewAccounts,
  PLAY_REVIEW_PHONE_NUMBERS,
} from '../authentication/play-review-accounts';
import { ActivityLedgerService } from '../database/activity-ledger.service';
import { PricingService } from '../database/pricing.service';
import { DatabaseService } from '../database/database.service';
import { ActivityType } from '../database/schemas/activities.schema';
import { AdminAuditAction } from '../database/schemas/admin-audit-log.schema';
import { RideOfferOutcome } from '../database/schemas/driver-ride-offer.schema';
import {
  RideApprovalStatus,
  RidesDocument,
  RideStatus,
  RideType,
  VehicleCategory,
} from '../database/schemas/rides.schema';
import {
  InactiveTripStatuses,
  PaymentMethod,
  Rating,
  TripDocument,
  TripFare,
  TripStatus,
  TripStopStatus,
} from '../database/schemas/trips.schema';
import { UserDocument } from '../database/schemas/user.schema';
import {
  UserReportDocument,
  UserReportStatus,
} from '../database/schemas/user-report.schema';
import { PushNotificationService } from '../notification/push-notification.service';
import { PaymentService } from '../payments/payment.service';
import { PaginationRequestDTO } from '../shared/pagination.dto';
import { Util } from '../shared/util';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { WebsocketEvent } from '../websocket/types';
import {
  MAX_HIRE_RIDE_IMAGES,
  AcceptRideDTO,
  AdminGetRentalsDTO,
  AdminGetTripsDTO,
  AdminCarBrandDTO,
  AdminCarBrandLogoDTO,
  AdminGetUserReportsDTO,
  CreateRideDTO,
  GetRideQuoteDTO,
  GetRidesDTO,
  GetTripHistoryDTO,
  HireRideDTO,
  MessageDTO,
  RequestRideDTO,
  RideStopsDTO,
  UpdateRideDTO,
  UpdateTripDTO,
  RatePassengerDTO,
  ReportTripUserDTO,
} from './dto/rides.dto';
import { GeolocationService } from './geolocation.service';
import { FinanceService } from '../finance/finance.service';

const RIDER_RENTAL_POPULATE = [
  {
    path: 'user',
    select: 'firstName lastName email phoneNumber avatar',
  },
  {
    path: 'driver',
    select: 'firstName lastName phoneNumber avatar isVerified languages',
  },
  { path: 'ride' },
];

// "Mercedes-Benz", "mercedes benz" and "MERCEDES-BENZ" all map to "mercedesbenz".
const toCarBrandSlug = (name = '') =>
  name.toLowerCase().replace(/[^a-z0-9]/g, '');

type ReviewRideOffer = {
  driverId: string;
  riderId: string;
  rideId: string;
  payload: RequestRideDTO & {
    amount: number;
    distance: number;
    fare?: TripFare;
  };
};

const EARLY_END_LOCATION_MAX_AGE_MS = 2 * 60 * 1000;

type TripCompletionOptions = {
  endedAt?: Date;
  endedBy?: UserDocument;
  endLocation?: {
    type: 'Point';
    coordinates: [number, number];
    accuracy?: number;
    heading?: number;
    recordedAt?: Date;
  };
  endReason?: string;
  partialDistance?: number;
  partialDuration?: number;
};

@Injectable()
export class RidesService implements OnModuleInit {
  private readonly WAIT_TIME = 20 * 1000;

  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly websocket: WebsocketGateway,
    private readonly db: DatabaseService,
    private readonly paymentService: PaymentService,
    private readonly activityLedger: ActivityLedgerService,
    private readonly push: PushNotificationService,
    private readonly finance: FinanceService,
    private readonly pricing: PricingService,
  ) {}

  private rejectPlayReviewerRealWorldAction(user: UserDocument) {
    if (getPlayReviewAccount(user.email)) {
      throw new BadRequestException(
        'Live bookings and driver availability are disabled for Play reviewer accounts',
      );
    }
  }

  getReviewMode(user: UserDocument) {
    const account = getPlayReviewAccount(user.email);
    return {
      canDeleteAccount:
        account?.kind === 'driverDeletion' || account?.kind === 'riderDeletion',
      canGenerateDemoRide: account?.kind === 'driver',
      canUseRiderDemo:
        account?.kind === 'rider' &&
        user.phoneNumber === PLAY_REVIEW_PHONE_NUMBERS.rider,
    };
  }

  private assertReusableRiderReviewAccount(user: UserDocument) {
    if (!this.getReviewMode(user).canUseRiderDemo) {
      throw new NotFoundException('review demo is not available');
    }
  }

  private findPlayReviewTrip(user: UserDocument, tripId: string) {
    return this.db.trips
      .findOne({
        _id: tripId,
        user: user.id,
        'meta.playReviewSynthetic': true,
        deleted: { $ne: true },
      })
      .populate('driver');
  }

  async advancePlayReviewTrip(user: UserDocument, tripId: string) {
    this.assertReusableRiderReviewAccount(user);

    const trip = await this.findPlayReviewTrip(user, tripId);

    if (!trip || !trip.driver) {
      throw new NotFoundException('review trip not found');
    }

    const driver = trip.driver as UserDocument;
    const startingStatus = trip.status;

    try {
      switch (startingStatus) {
        case TripStatus.Started:
          return await this.annouceArrival(driver, tripId);
        case TripStatus.DriverArrived:
          return await this.startTrip(driver, tripId);
        case TripStatus.InProgress:
          if (
            trip.tripStops?.some(
              (stop) => stop.status !== TripStopStatus.Completed,
            )
          ) {
            return await this.completeTripStop(driver, tripId);
          }
          return await this.endTrip(driver, tripId);
        case TripStatus.Completed:
          return trip;
        default:
          throw new BadRequestException('review trip cannot be advanced');
      }
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        throw error;
      }

      // Two mounted clients or delayed timers can request the same demo phase.
      // If another request already moved the trip forward, return that state.
      const currentTrip = await this.findPlayReviewTrip(user, tripId);
      if (currentTrip?.driver && currentTrip.status !== startingStatus) {
        return currentTrip;
      }

      throw error;
    }
  }

  async advancePlayReviewRental(user: UserDocument, rentalId: string) {
    this.assertReusableRiderReviewAccount(user);

    const rental = await this.db.rentals.findOne({
      _id: rentalId,
      user: user.id,
      'meta.playReviewSynthetic': true,
      deleted: { $ne: true },
    });

    if (!rental) {
      throw new NotFoundException('review rental not found');
    }

    const nextStatus: Partial<Record<RentalStatus, RentalStatus>> = {
      [RentalStatus.Pending]: RentalStatus.Accepted,
      [RentalStatus.Accepted]: RentalStatus.InProgress,
      [RentalStatus.InProgress]: RentalStatus.Completed,
    };
    const status = nextStatus[rental.status];

    if (!status) {
      if (rental.status === RentalStatus.Completed) {
        return rental;
      }
      throw new BadRequestException('review rental cannot be advanced');
    }

    return this.updateRentalStatus(rentalId, status);
  }

  async createReviewDemoOffer(driver: UserDocument) {
    const account = getPlayReviewAccount(driver.email);
    if (account?.kind !== 'driver') {
      throw new NotFoundException('review demo is not available');
    }

    const activeTrip = await this.db.trips.findOne({
      driver: driver.id,
      'meta.playReviewSynthetic': true,
      status: { $nin: InactiveTripStatuses },
      deleted: { $ne: true },
    });
    if (activeTrip) {
      const cancelledTrip = await this.db.trips.findOneAndUpdate(
        {
          _id: activeTrip.id,
          driver: driver.id,
          'meta.playReviewSynthetic': true,
          status: { $nin: InactiveTripStatuses },
        },
        {
          $set: {
            cancellationReason: 'Reset before generating a new demo ride',
            cancelledBy: driver.id,
            endedAt: new Date(),
            status: TripStatus.Cancelled,
          },
        },
        { new: true, upsert: false },
      );

      if (cancelledTrip) {
        this.websocket.emitToUser(driver, 'TripCancelled', cancelledTrip);
        this.websocket.emitToUser(
          activeTrip.user as UserDocument | string,
          'TripCancelled',
          cancelledTrip,
        );
      }
    }

    // A previous reviewer session can leave its reusable vehicle Busy even
    // when the synthetic trip is no longer queryable. Generating a demo is an
    // explicit request to reset that isolated reviewer state.
    await this.db.rides.updateMany(
      {
        approvalStatus: RideApprovalStatus.Approved,
        deleted: { $ne: true },
        driver: driver.id,
        'specs.synthetic': true,
        type: { $ne: RideType.Hire },
      },
      { $set: { status: RideStatus.Online } },
    );

    const riderAccount = getPlayReviewAccounts().find(
      (candidate) => candidate.kind === 'rider',
    );
    const [rider, ride] = await Promise.all([
      riderAccount
        ? this.db.users.findOne({
            email: riderAccount.email,
            deleted: { $ne: true },
          })
        : null,
      this.db.rides.findOne({
        driver: driver.id,
        deleted: { $ne: true },
        'specs.synthetic': true,
        status: RideStatus.Online,
        type: { $ne: RideType.Hire },
      }),
    ]);
    if (!rider || !ride) {
      throw new BadRequestException(
        'Go online with the review vehicle before generating a demo ride',
      );
    }

    const trackingId = `review-${Math.random().toString(32).substring(2)}`;
    const reviewCategory =
      ride.type === RideType.Luxury
        ? VehicleCategory.Luxury
        : VehicleCategory.Classic;
    const payload: ReviewRideOffer['payload'] = {
      amount: 0,
      distance: 3200,
      fromAddress: 'Transcorp Hilton Abuja, Maitama',
      fromLat: 9.0747,
      fromLon: 7.4951,
      paymentMethod: PaymentMethod.Cash,
      stops: [],
      toAddress: 'Millennium Park, Abuja',
      toLat: 9.0667,
      toLon: 7.5008,
      type: reviewCategory,
    };
    const offer: ReviewRideOffer = {
      driverId: String(driver.id),
      riderId: String(rider.id),
      rideId: String(ride.id),
      payload,
    };
    const expiresInSeconds = (this.WAIT_TIME * 2) / 1000;
    const rideRequest = {
      expiresAt: new Date(Date.now() + this.WAIT_TIME * 2).toISOString(),
      expiresInSeconds,
      trackingId,
      user: rider,
      payload,
    };

    await Promise.all([
      this.cache.set(trackingId, false, this.WAIT_TIME * 2),
      this.cache.set(`review-offer:${trackingId}`, offer, this.WAIT_TIME * 2),
      this.recordRideOffer({
        driverId: String(driver.id),
        rideId: String(ride.id),
        requestedCategory: reviewCategory,
        userId: String(rider.id),
        trackingId,
      }),
    ]);

    this.websocket.emitToUser(driver, 'RideRequest', rideRequest);

    return rideRequest;
  }

  private async acceptReviewDemoOffer(
    driver: UserDocument,
    trackingId: string,
    offer: ReviewRideOffer,
  ) {
    if (offer.driverId !== String(driver.id)) {
      throw new BadRequestException('invalid tracking id');
    }
    const [rider, ride] = await Promise.all([
      this.db.users.findOne({ _id: offer.riderId, deleted: { $ne: true } }),
      this.db.rides.findOne({
        _id: offer.rideId,
        driver: driver.id,
        'specs.synthetic': true,
        deleted: { $ne: true },
      }),
    ]);
    if (!rider || !ride) {
      throw new BadRequestException('review demo is unavailable');
    }

    const trip = await this.db.trips.create({
      ...offer.payload,
      amount: 0,
      driver,
      from: {
        type: 'Point',
        coordinates: [offer.payload.fromLat, offer.payload.fromLon],
      },
      meta: { playReviewSynthetic: true },
      ride,
      rideCategory: offer.payload.type,
      status: TripStatus.Started,
      to: {
        type: 'Point',
        coordinates: [offer.payload.toLat, offer.payload.toLon],
      },
      tripStops: [],
      user: rider,
    });
    await Promise.all([
      this.db.rides.updateOne(
        { _id: ride.id },
        { $set: { status: RideStatus.Busy } },
      ),
      this.cache.del(trackingId),
      this.cache.del(`review-offer:${trackingId}`),
      this.resolveRideOffer(trackingId, RideOfferOutcome.Accepted, {
        tripId: trip.id,
      }),
    ]);

    const responseTrip = {
      ...(typeof trip.toObject === 'function' ? trip.toObject() : trip),
      driver,
      ride,
      user: rider,
    };
    this.websocket.emitToUser(driver, 'TripStarted', responseTrip);
    return responseTrip;
  }

  async onModuleInit() {
    // Grandfather existing trip vehicles so current drivers keep working.
    await this.db.rides.updateMany(
      {
        type: { $ne: RideType.Hire },
        deleted: { $ne: true },
        $or: [{ approvalStatus: { $exists: false } }, { approvalStatus: null }],
      },
      { $set: { approvalStatus: RideApprovalStatus.Approved } },
    );
  }

  private async getTripCounterparty(user: UserDocument, tripId: string) {
    const trip = await this.db.trips
      .findOne({
        _id: tripId,
        $or: [{ user: user.id }, { driver: user.id }],
        deleted: { $ne: true },
      })
      .populate('user')
      .populate('driver');

    if (!trip) {
      throw new NotFoundException('trip not found');
    }

    const rider = trip.user as UserDocument;
    const driver = trip.driver as UserDocument;
    const counterparty = String(user.id) === String(driver.id) ? rider : driver;

    if (!counterparty?.id || String(counterparty.id) === String(user.id)) {
      throw new NotFoundException('trip participant not found');
    }

    return { counterparty, trip };
  }

  private async isUserPairBlocked(firstUserId: string, secondUserId: string) {
    return Boolean(
      await this.db.userBlocks.exists({
        active: true,
        $or: [
          { blocker: firstUserId, blocked: secondUserId },
          { blocker: secondUserId, blocked: firstUserId },
        ],
      }),
    );
  }

  private async getBlockedPairUserIds(userId: string) {
    const blocks = await this.db.userBlocks
      .find({
        active: true,
        $or: [{ blocker: userId }, { blocked: userId }],
      })
      .select('blocker blocked');

    return blocks
      .map((block) => {
        const blockerId = Util.resolveDocumentId(block.blocker);
        const blockedId = Util.resolveDocumentId(block.blocked);
        return blockerId === String(userId) ? blockedId : blockerId;
      })
      .filter((id): id is string => Boolean(id));
  }

  async blockTripUser(user: UserDocument, tripId: string) {
    const { counterparty, trip } = await this.getTripCounterparty(user, tripId);

    return this.db.userBlocks.findOneAndUpdate(
      { blocker: user.id, blocked: counterparty.id },
      {
        $set: {
          active: true,
          sourceTrip: trip.id,
        },
        $unset: { unblockedAt: 1 },
      },
      { new: true, setDefaultsOnInsert: true, upsert: true },
    );
  }

  async reportTripUser(
    user: UserDocument,
    tripId: string,
    payload: ReportTripUserDTO,
  ) {
    const { counterparty, trip } = await this.getTripCounterparty(user, tripId);
    let messageId: string | undefined;

    if (payload.messageId) {
      const message = await this.db.messages.findOne({
        _id: payload.messageId,
        sender: counterparty.id,
        trip: trip.id,
      });
      if (!message) {
        throw new NotFoundException('message not found in this trip');
      }
      messageId = String(message.id);
    }

    if (payload.blockUser) {
      await this.db.userBlocks.findOneAndUpdate(
        { blocker: user.id, blocked: counterparty.id },
        {
          $set: { active: true, sourceTrip: trip.id },
          $unset: { unblockedAt: 1 },
        },
        { new: true, setDefaultsOnInsert: true, upsert: true },
      );
    }

    return this.db.userReports.create({
      blockedUser: Boolean(payload.blockUser),
      details: payload.details?.trim() || undefined,
      message: messageId,
      reason: payload.reason,
      reportedUser: counterparty.id,
      reporter: user.id,
      status: UserReportStatus.Open,
      trip: trip.id,
    });
  }

  async getBlockedUsers(user: UserDocument) {
    return this.db.userBlocks
      .find({ active: true, blocker: user.id })
      .sort({ createdAt: -1 })
      .populate({
        path: 'blocked',
        select: 'firstName lastName avatar',
      });
  }

  async unblockUser(user: UserDocument, blockedUserId: string) {
    if (!isMongoId(blockedUserId)) {
      throw new BadRequestException('invalid blocked user id');
    }

    const block = await this.db.userBlocks.findOneAndUpdate(
      { active: true, blocker: user.id, blocked: blockedUserId },
      { $set: { active: false, unblockedAt: new Date() } },
      { new: true, upsert: false },
    );
    if (!block) {
      throw new NotFoundException('blocked user not found');
    }

    return block;
  }

  async getUserReports(payload: AdminGetUserReportsDTO) {
    const { page = 1, limit = 100, reason, status } = payload;
    const query: FilterQuery<UserReportDocument> = {};
    if (reason) query.reason = reason;
    if (status) query.status = status;

    return this.db.userReports.paginate(query, {
      page,
      limit,
      sort: { createdAt: -1 },
      populate: [
        { path: 'reporter', select: 'firstName lastName email phoneNumber' },
        {
          path: 'reportedUser',
          select: 'firstName lastName email phoneNumber',
        },
        { path: 'trip' },
        { path: 'message' },
      ],
    });
  }

  async updateUserReportStatus(reportId: string, status: UserReportStatus) {
    if (!isMongoId(reportId)) {
      throw new BadRequestException('invalid report id');
    }

    return this.db.findAndUpdateOrFail<UserReportDocument>(
      this.db.userReports,
      { _id: reportId },
      { $set: { status } },
      {
        error: new NotFoundException('user report not found'),
        options: { new: true, upsert: false },
        populate: [
          { path: 'reporter', select: 'firstName lastName email phoneNumber' },
          {
            path: 'reportedUser',
            select: 'firstName lastName email phoneNumber',
          },
          { path: 'trip' },
          { path: 'message' },
        ],
      },
    );
  }

  async getAvailableRides(user: UserDocument, payload: GetRidesDTO) {
    const { lat, lon, type } = payload;
    const types = type ? (Array.isArray(type) ? type : [type]) : null;
    const isHireOnly = types?.length === 1 && types[0] === RideType.Hire;
    const isRiderReviewer = getPlayReviewAccount(user.email)?.kind === 'rider';

    const query: FilterQuery<RidesDocument> = {
      deleted: { $ne: true },
      'specs.synthetic': isHireOnly && isRiderReviewer ? true : { $ne: true },
      status: { $in: [RideStatus.Online, RideStatus.FinishingTrip] },
    };
    const blockedUserIds = await this.getBlockedPairUserIds(String(user.id));
    if (blockedUserIds.length > 0) {
      query.driver = { $nin: blockedUserIds };
    }

    if (types) {
      query.type = { $in: types };
      if (!isHireOnly) {
        query.$or = [
          { vehicleCategory: { $in: types } },
          { vehicleCategory: { $exists: false }, type: { $in: types } },
        ];
      }
    } else {
      // Default trip catalogue excludes Hire fleet cars
      query.type = { $ne: RideType.Hire };
    }

    if (!isHireOnly) {
      query.approvalStatus = RideApprovalStatus.Approved;
      query.location = {
        $near: {
          // Stored as [lat, lon] to match existing ride documents / clients.
          $geometry: { type: 'Point', coordinates: [lat, lon] },
          $maxDistance: payload.radius || 5000,
        },
      };
    }

    return this.db.rides
      .find(query)
      .populate({ path: 'driver', select: 'avatar firstName lastName' })
      .sort(isHireOnly ? { createdAt: -1 } : undefined);
  }

  /** Prices for each ride type, from the rates admins set on the Pricing page. */
  async getRideQuotes(payload: GetRideQuoteDTO) {
    const pickup =
      typeof payload.fromLat === 'number' && typeof payload.fromLon === 'number'
        ? ([payload.fromLat, payload.fromLon] as [number, number])
        : undefined;
    return this.pricing.quote(payload.distance, payload.duration, pickup);
  }

  async getOngoingTrip(user: UserDocument) {
    const trackingId = await this.cache.get(`${user.id}`);
    if (trackingId) {
      return { trackingId };
    }

    const tripQuery: FilterQuery<TripDocument> = {
      $or: [{ user: user.id }, { driver: user.id }],
      status: { $nin: InactiveTripStatuses },
      deleted: { $ne: true },
    };
    if (getPlayReviewAccount(user.email)?.kind === 'driver') {
      tripQuery['meta.playReviewSynthetic'] = { $ne: true };
    }

    const trip = await this.db.trips
      .findOne(tripQuery)
      .populate({
        path: 'ride',
        populate: { path: 'driver' },
      })
      .populate('user')
      .populate('driver');

    // Driver closed the app mid-trip earlier and the trip was cancelled/completed
    // elsewhere — free a stuck Busy ride so they can go online again.
    if (!trip) {
      await this.db.rides.updateOne(
        {
          driver: user.id,
          deleted: { $ne: true },
          status: { $in: [RideStatus.Busy, RideStatus.FinishingTrip] },
        },
        { $set: { status: RideStatus.Offline } },
      );
    }

    return trip;
  }

  async getOngoingTripLocation(user: UserDocument) {
    const ongoing = await this.getOngoingTrip(user);

    if (
      !ongoing ||
      typeof ongoing !== 'object' ||
      !('id' in ongoing) ||
      !ongoing.id
    ) {
      return null;
    }

    const live = this.websocket.getLastRideLocation(ongoing.id);
    if (live) {
      return live;
    }

    const ride =
      ongoing.ride && typeof ongoing.ride !== 'string' ? ongoing.ride : null;
    const [latitude, longitude] = ride?.location?.coordinates ?? [];

    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return null;
    }

    return {
      accuracy: ride?.location?.accuracy,
      tripId: ongoing.id,
      rideId: ride.id,
      lat: latitude,
      lon: longitude,
      heading: ride?.location?.heading,
      recordedAt: ride?.location?.recordedAt
        ? new Date(ride.location.recordedAt).toISOString()
        : new Date().toISOString(),
      sequence: ride?.location?.sequence,
      speed: ride?.location?.speed,
      updatedAt: new Date().toISOString(),
    };
  }

  async requestRide(user: UserDocument, payload: RequestRideDTO) {
    const { fromLat, fromLon, type, paymentMethod } = payload;
    const [ongoingTrip, ongoingRequest] = await Promise.all([
      this.db.trips.findOne({
        user: user.id,
        status: { $nin: InactiveTripStatuses },
        deleted: { $ne: true },
      }),
      this.cache.get(`${user.id}`),
    ]);
    if (ongoingTrip) {
      throw new BadRequestException('another trip currently ongoing');
    }
    if (ongoingRequest) {
      throw new BadRequestException('previous request still pending');
    }

    const reviewerAccount = getPlayReviewAccount(user.email);
    if (reviewerAccount?.kind === 'rider') {
      return this.createPlayReviewTrip(user, payload);
    }
    if (reviewerAccount) {
      this.rejectPlayReviewerRealWorldAction(user);
    }

    const trackingId = Math.random().toString(32).substring(2);
    const [_available, route] = await Promise.all([
      this.db.rides
        .find({
          approvalStatus: RideApprovalStatus.Approved,
          deleted: { $ne: true },
          'specs.synthetic': { $ne: true },
          status: { $in: [RideStatus.Online, RideStatus.FinishingTrip] },
          type,
          $or: [
            { vehicleCategory: type },
            { vehicleCategory: { $exists: false }, type },
          ],
          location: {
            $near: {
              $geometry: { type: 'Point', coordinates: [fromLat, fromLon] },
              $maxDistance: 5000,
            },
          },
        })
        .populate('driver'),
      GeolocationService.getRouteSummaryWithStops(
        [payload.fromLat, payload.fromLon],
        [payload.toLat, payload.toLon],
        (payload.stops || []).map((stop) => [stop.toLat, stop.toLon]),
      ),
    ]);
    const { distance } = route;
    // The price is fixed here and stored on the trip, so the rider pays what they were quoted.
    const fare = await this.pricing.fareFor(type, distance, route.duration, [
      payload.fromLat,
      payload.fromLon,
    ]);
    const { amount } = fare;
    if (paymentMethod === PaymentMethod.RULBalance) {
      const balance = await this.db.balances.findOne({
        user: user.id,
        deleted: { $ne: true },
      });
      if ((balance?.amount || 0) < amount) {
        throw new BadRequestException('insufficient RUL balance');
      }
    }

    if (paymentMethod === PaymentMethod.Card) {
      const card = await this.db.cards.findOne({
        user: user.id,
        isDefault: true,
        deleted: { $ne: true },
      });
      if (!card) {
        throw new BadRequestException('no/invalid card setup');
      }
    }

    const eligibility = await Promise.all(
      _available.map(async (ride) => {
        const candidate = ride.driver as UserDocument | undefined;
        if (!candidate?.id || getPlayReviewAccount(candidate.email)) {
          return false;
        }
        const eligible = await this.finance.canDriverReceiveRides(candidate.id);
        if (!eligible) {
          await this.db.rides.updateOne(
            { _id: ride.id, status: RideStatus.Online },
            { $set: { status: RideStatus.Offline } },
          );
        }
        return eligible;
      }),
    );
    const available = _available
      .filter((_ride, index) => eligibility[index])
      .sort((a) => (a.status === RideStatus.Online ? -1 : 1));
    if (!available.length) {
      throw new BadRequestException('All drivers are busy at this time');
    }

    await Promise.all([
      this.cache.set(trackingId, true, this.WAIT_TIME * available.length * 2),
      this.cache.set(
        `${user.id}`,
        trackingId,
        this.WAIT_TIME * available.length * 2,
      ),
    ]);
    this.connectToDriver(user, available, trackingId, {
      ...payload,
      amount,
      distance,
      fare,
    });

    return { ride: available[0], trackingId };
  }

  private async createPlayReviewTrip(
    user: UserDocument,
    payload: RequestRideDTO,
  ) {
    const ride = await this.db.rides
      .findOne({
        deleted: { $ne: true },
        'specs.synthetic': true,
        type: payload.type,
      })
      .populate('driver');
    if (!ride || !ride.driver) {
      throw new BadRequestException(
        'The synthetic review vehicle is unavailable',
      );
    }

    const distance = await GeolocationService.getDistance(
      [payload.fromLat, payload.fromLon],
      [payload.toLat, payload.toLon],
    );
    const quotes = await this.getRideQuotes({ distance });
    const quotedAmount = quotes[payload.type.toLowerCase()] || 0;
    const trip = await this.db.trips.create({
      amount: 0,
      distance,
      driver: ride.driver,
      from: {
        type: 'Point',
        coordinates: [payload.fromLat, payload.fromLon],
      },
      fromAddress: payload.fromAddress,
      meta: {
        playReviewSynthetic: true,
        quotedAmount,
      },
      paymentMethod: payload.paymentMethod,
      ride,
      rideCategory: payload.type,
      status: TripStatus.Started,
      to: {
        type: 'Point',
        coordinates: [payload.toLat, payload.toLon],
      },
      toAddress: payload.toAddress,
      tripStops: (payload.stops || []).map((stop) => ({
        status: TripStopStatus.Pending,
        to: { type: 'Point', coordinates: [stop.toLat, stop.toLon] },
        toAddress: stop.toAddress,
      })),
      user,
    });
    const tripObject =
      typeof trip.toObject === 'function' ? trip.toObject() : trip;
    const responseTrip = {
      ...tripObject,
      driver: ride.driver,
      ride,
      user,
    };

    this.websocket.emitToUser(user, 'TripStarted', responseTrip);

    return { ride, trackingId: String(trip.id), trip: responseTrip };
  }

  async cancelConnection(user: UserDocument, payload: AcceptRideDTO) {
    const { trackingId } = payload;
    const reviewOffer = await this.cache.get<ReviewRideOffer>(
      `review-offer:${trackingId}`,
    );
    if (reviewOffer?.driverId === String(user.id)) {
      await Promise.all([
        this.cache.del(trackingId),
        this.cache.del(`review-offer:${trackingId}`),
        this.resolveRideOffer(trackingId, RideOfferOutcome.TimedOut),
      ]);
      return;
    }
    const value = await this.cache.get<string>(`${user.id}`);
    if (value !== trackingId) {
      // Already cancelled, expired, or closed by the other party — treat as success.
      if (trackingId) {
        await this.cache.set(trackingId, false, this.WAIT_TIME);
      }
      return;
    }

    await this.cache.del(`${user.id}`);
    await this.cache.set(payload.trackingId, false, this.WAIT_TIME);
  }

  async acceptRide(driver: UserDocument, payload: AcceptRideDTO) {
    const reviewOffer = await this.cache.get<ReviewRideOffer>(
      `review-offer:${payload.trackingId}`,
    );
    if (reviewOffer) {
      const account = getPlayReviewAccount(driver.email);
      if (account?.kind !== 'driver') {
        throw new BadRequestException('invalid tracking id');
      }
      return this.acceptReviewDemoOffer(
        driver,
        payload.trackingId,
        reviewOffer,
      );
    }
    if (!(await this.finance.canDriverReceiveRides(driver.id))) {
      throw new BadRequestException(
        'Pay the required cash-trip commission deposit before accepting rides',
      );
    }
    const { trackingId } = payload;
    const offer = await this.db.driverRideOffers.findOne({
      trackingId,
      driver: driver.id,
      outcome: RideOfferOutcome.Pending,
    });
    if (!offer) {
      throw new BadRequestException('invalid tracking id');
    }
    const offeredRideId =
      typeof offer.ride === 'string' ? offer.ride : String(offer.ride?.id);
    const eligibleRide = await this.db.rides.findOne({
      _id: offeredRideId,
      driver: driver.id,
      approvalStatus: RideApprovalStatus.Approved,
      deleted: { $ne: true },
      status: { $in: [RideStatus.Online, RideStatus.FinishingTrip] },
      type: offer.requestedCategory,
      $or: [
        { vehicleCategory: offer.requestedCategory },
        {
          vehicleCategory: { $exists: false },
          type: offer.requestedCategory,
        },
      ],
    });
    if (!eligibleRide) {
      throw new BadRequestException(
        'vehicle is no longer eligible for this ride',
      );
    }
    const value = await this.cache.get<boolean>(trackingId);
    if (typeof value !== 'boolean') {
      throw new BadRequestException('invalid tracking id');
    }

    await this.cache.set(payload.trackingId, true, this.WAIT_TIME * 2);
    return undefined;
  }

  async connectToDriver(
    user: UserDocument,
    available: RidesDocument[],
    connectionId: string,
    payload: RequestRideDTO & {
      distance: number;
      amount: number;
      fare?: TripFare;
    },
  ) {
    // Offer flag must outlive the wait window
    const offerTtl = this.WAIT_TIME * 2;
    let trackingId: string;
    for (let i = 0; i < available.length; i += 1) {
      const ride = available[i];
      const driver = ride.driver as UserDocument;

      if (!driver?.id) {
        continue;
      }

      if (await this.isUserPairBlocked(String(user.id), String(driver.id))) {
        continue;
      }

      if (!(await this.finance.canDriverReceiveRides(driver.id))) {
        await this.db.rides.updateOne(
          { _id: ride.id },
          { $set: { status: RideStatus.Offline } },
        );
        continue;
      }

      trackingId = Math.random().toString(32).substring(2);
      const expiresAt = new Date(Date.now() + this.WAIT_TIME).toISOString();

      await this.recordRideOffer({
        driverId: driver.id,
        rideId: ride.id,
        requestedCategory: payload.type,
        userId: user.id,
        trackingId,
      });
      await this.cache.set(trackingId, false, offerTtl);

      this.websocket.emitToUser(user, 'ConnectingToDriver', ride);
      this.websocket.emitToUser(driver, 'RideRequest', {
        expiresAt,
        trackingId,
        user,
        payload,
      });
      this.push.sendToUser(driver, {
        title: 'New ride request',
        body: payload.fromAddress
          ? `Pickup near ${payload.fromAddress}`
          : 'A rider is requesting a ride nearby',
        app: 'driver',
        channelId: 'driver-ride-requests-v1',
        sound: 'new_ride_request.wav',
        data: {
          type: 'RideRequest',
          trackingId,
        },
      });

      await new Promise((resolve) => {
        setTimeout(resolve, this.WAIT_TIME);
      });

      const [accepted, waiting] = await Promise.all([
        this.cache.get<boolean>(trackingId),
        this.cache.get<boolean>(connectionId),
      ]);
      if (!waiting) {
        await this.resolveRideOffer(
          trackingId,
          RideOfferOutcome.CancelledByRider,
        );
        this.websocket.emitToUser(user, 'RideRequestCancelled', {
          trackingId: connectionId,
        });
        this.websocket.emitToUser(driver, 'RideRequestCancelled', {
          trackingId,
        });
        this.push.sendToUser(driver, {
          title: 'Ride request cancelled',
          body: 'The rider cancelled this request',
          app: 'driver',
          data: {
            type: 'RideRequestCancelled',
            trackingId,
          },
        });

        await Promise.all([
          this.cache.del(connectionId),
          this.cache.del(`${user.id}`),
        ]);
        return;
      }

      if (accepted === true) {
        const eligibleRide = await this.db.rides.findOne({
          _id: ride.id,
          driver: driver.id,
          approvalStatus: RideApprovalStatus.Approved,
          deleted: { $ne: true },
          status: { $in: [RideStatus.Online, RideStatus.FinishingTrip] },
          type: payload.type,
          $or: [
            { vehicleCategory: payload.type },
            { vehicleCategory: { $exists: false }, type: payload.type },
          ],
        });
        if (!eligibleRide) {
          await this.resolveRideOffer(trackingId, RideOfferOutcome.TimedOut);
          this.websocket.emitToUser(driver, 'RideRequestExpired', {
            reason: 'vehicle_ineligible',
            trackingId,
          });
          continue;
        }
        const [trip] = await Promise.all([
          this.db.trips.create({
            ...payload,
            to: {
              type: 'Point',
              coordinates: [payload.toLat, payload.toLon],
            },
            from: {
              type: 'Point',
              coordinates: [payload.fromLat, payload.fromLon],
            },
            user,
            ride: eligibleRide,
            driver,
            rideCategory: payload.type,
            meta: {
              bookedStopsIncludedInFare: (payload.stops?.length || 0) > 0,
            },
            tripStops: (payload.stops || []).map((stop) => ({
              to: { type: 'Point', coordinates: [stop.toLat, stop.toLon] },
              toAddress: stop.toAddress,
            })),
          }),
          this.db.rides.updateOne(
            { _id: ride.id },
            { status: RideStatus.Busy },
          ),
          this.closeOnlineSession(driver.id),
          this.cache.del(connectionId),
          this.cache.del(`${user.id}`),
        ]);

        await this.resolveRideOffer(trackingId, RideOfferOutcome.Accepted, {
          tripId: trip.id,
        });

        this.websocket.emitToUser(user, 'TripStarted', trip);
        this.websocket.emitToUser(driver, 'TripStarted', trip);
        this.push.sendToUser(user, {
          title: 'Driver on the way',
          body: 'Your driver accepted the ride',
          app: 'rider',
          channelId: 'rider-booking-updates-v1',
          sound: 'booking_accepted.wav',
          data: {
            type: 'TripStarted',
            tripId: String(trip.id),
          },
        });

        return;
      }

      await this.resolveRideOffer(trackingId, RideOfferOutcome.TimedOut);
      this.websocket.emitToUser(driver, 'RideRequestExpired', {
        reason: 'timed_out',
        trackingId,
      });
    }

    await Promise.all([
      this.cache.del(connectionId),
      this.cache.del(`${user.id}`),
    ]);
    this.websocket.emitToUser(
      user,
      'DriversBusy',
      'All drivers are busy at this time',
    );
  }

  async cancelTrip(user: UserDocument, tripId: string, reason: string) {
    const existing = await this.db.trips
      .findOne({
        _id: tripId,
        $or: [{ user: user.id }, { driver: user.id }],
      })
      .populate('user driver ride');

    if (!existing) {
      throw new NotFoundException('trip not found');
    }

    if (existing.status === TripStatus.Cancelled) {
      return existing;
    }

    if (existing.status === TripStatus.InProgress) {
      return this.endTripEarly(user, existing, reason);
    }

    if (
      existing.status !== TripStatus.Started &&
      existing.status !== TripStatus.DriverArrived
    ) {
      throw new BadRequestException(
        `Cannot cancel trip in ${existing.status} status`,
      );
    }

    const trip = await this.db.trips
      .findOneAndUpdate(
        {
          _id: tripId,
          status: { $in: [TripStatus.Started, TripStatus.DriverArrived] },
          $or: [{ user: user.id }, { driver: user.id }],
        },
        {
          $set: {
            status: TripStatus.Cancelled,
            cancellationReason: reason,
            cancelledBy: user.id,
          },
        },
        { new: true, upsert: false },
      )
      .populate('user driver');

    if (!trip) {
      const raced = await this.db.trips
        .findOne({
          _id: tripId,
          $or: [{ user: user.id }, { driver: user.id }],
        })
        .populate('user driver');
      if (raced?.status === TripStatus.Cancelled) {
        return raced;
      }
      throw new NotFoundException('trip not found');
    }

    const rider = trip.user as UserDocument;
    const driver = trip.driver as UserDocument;
    const isPlayReviewSynthetic = trip.meta?.playReviewSynthetic === true;

    if (isPlayReviewSynthetic) {
      this.websocket.emitToUser(rider, 'TripCancelled', trip);
      return trip;
    }

    await this.db.rides.updateOne(
      { _id: trip.ride },
      { $set: { status: RideStatus.Online } },
    );
    await this.openOnlineSession(driver.id, String(trip.ride));

    this.websocket.emitToUser(rider, 'TripCancelled', trip);
    this.websocket.emitToUser(driver, 'TripCancelled', trip);

    const cancelledByRider = String(user.id) === String(rider.id);
    const recipient = cancelledByRider ? driver : rider;
    this.push.sendToUser(recipient, {
      title: 'Trip cancelled',
      body: cancelledByRider
        ? 'The rider cancelled the trip'
        : 'The driver cancelled the trip',
      app: cancelledByRider ? 'driver' : 'rider',
      data: {
        type: 'TripCancelled',
        tripId: String(trip.id),
      },
    });

    return trip;
  }

  async sendMessage(_user: UserDocument, tripId: string, payload: MessageDTO) {
    const trip = await this.db.findOrFail<TripDocument>(
      this.db.trips,
      {
        _id: tripId,
        $or: [{ user: _user.id }, { driver: _user.id }],
      },
      {
        error: new NotFoundException('trip not found'),
        populate: [{ path: 'user' }, { path: 'driver' }],
      },
    );
    const message = await this.db.messages.create({
      sender: _user.id,
      trip,
      text: payload.text,
    });

    const driver = trip.driver as UserDocument;
    const user = trip.user as UserDocument;

    this.websocket.emitToUser(driver, 'NewMessage', message);
    this.websocket.emitToUser(user, 'NewMessage', message);

    const recipient = String(_user.id) === String(user.id) ? driver : user;
    const preview =
      payload.text.length > 80
        ? `${payload.text.slice(0, 77)}...`
        : payload.text;
    this.push.sendToUser(recipient, {
      title: 'New message',
      body: preview,
      app: String(recipient.id) === String(driver.id) ? 'driver' : 'rider',
      channelId: 'trip-messages-v1',
      sound: 'chat_message.wav',
      data: {
        type: 'NewMessage',
        tripId: String(trip.id),
      },
    });

    return message;
  }

  async getMessages(user: UserDocument, tripId: string) {
    const trip = await this.db.findOrFail<TripDocument>(
      this.db.trips,
      {
        _id: tripId,
        $or: [{ user: user.id }, { driver: user.id }],
      },
      { error: new NotFoundException('trip not found') },
    );

    return this.db.messages.find({ trip: trip.id }).sort({ createdAt: 1 });
  }

  async updateTrip(user: UserDocument, tripId: string, payload: UpdateTripDTO) {
    let trip: TripDocument;
    if (payload.status) {
      switch (payload.status) {
        case TripStatus.DriverArrived:
          trip = await this.annouceArrival(user, tripId);
          break;
        case TripStatus.InProgress:
          trip = await this.startTrip(user, tripId);
          break;
        case TripStatus.Completed:
          trip = await this.endTrip(user, tripId);
          break;
        default:
        // do nothing
      }
    }
    if (payload.rating) {
      trip = await this.rateTrip(user, tripId, payload.rating);
    }
    if (payload.stops) {
      trip = await this.updateTripStops(user, tripId, payload.stops);
    }
    if (payload.completeStop) {
      trip = await this.completeTripStop(user, tripId);
    }

    if (!trip) {
      throw new BadRequestException('trip not updated');
    }

    return trip;
  }

  async annouceArrival(user: UserDocument, tripId: string) {
    const trip = await this.db.findAndUpdateOrFail<TripDocument>(
      this.db.trips,
      {
        _id: tripId,
        status: TripStatus.Started,
        driver: user.id,
      },
      { $set: { arrivedAt: new Date(), status: TripStatus.DriverArrived } },
      {
        populate: { path: 'user driver' },
        options: { upsert: false, new: true },
        error: new NotFoundException('trip not found'),
      },
    );

    this.websocket.emitToUser(trip.user as UserDocument, 'DriverArrival', trip);
    this.websocket.emitToUser(
      trip.driver as UserDocument,
      'DriverArrival',
      trip,
    );
    this.push.sendToUser(trip.user as UserDocument, {
      title: 'Driver has arrived',
      body: 'Your driver is waiting at the pickup',
      app: 'rider',
      channelId: 'rider-driver-arrival-v1',
      sound: 'driver_arrived.wav',
      data: {
        type: 'DriverArrival',
        tripId: String(trip.id),
      },
    });

    return trip;
  }

  async startTrip(user: UserDocument, tripId: string) {
    const trip = await this.db.findAndUpdateOrFail<TripDocument>(
      this.db.trips,
      {
        _id: tripId,
        status: TripStatus.DriverArrived,
        driver: user.id,
      },
      {
        $set: {
          status: TripStatus.InProgress,
          startedAt: new Date(),
        },
      },
      {
        populate: { path: 'user driver' },
        options: { upsert: false, new: true },
        error: new NotFoundException('trip not found'),
      },
    );

    this.websocket.emitToUser(
      trip.user as UserDocument,
      'TripInProgress',
      trip,
    );
    this.websocket.emitToUser(
      trip.driver as UserDocument,
      'TripInProgress',
      trip,
    );
    this.push.sendToUser(trip.user as UserDocument, {
      title: 'Trip started',
      body: 'Your trip is now in progress',
      app: 'rider',
      data: {
        type: 'TripInProgress',
        tripId: String(trip.id),
      },
    });

    return trip;
  }

  async endTrip(driver: UserDocument, tripId: string) {
    const trip = await this.db.findOrFail<TripDocument>(
      this.db.trips,
      {
        _id: tripId,
        status: TripStatus.InProgress,
        driver: driver.id,
      },
      {
        populate: [{ path: 'user' }, { path: 'ride', select: 'type' }],
        error: new NotFoundException('trip not found'),
      },
    );

    if (
      (trip.tripStops || []).some(
        (stop) => stop.status !== TripStopStatus.Completed,
      )
    ) {
      throw new BadRequestException(
        'complete the scheduled stop before ending the trip',
      );
    }

    return this.completeTrip(trip, driver);
  }

  async completeTripStop(driver: UserDocument, tripId: string) {
    const trip = await this.db.findOrFail<TripDocument>(this.db.trips, {
      _id: tripId,
      driver: driver.id,
      status: TripStatus.InProgress,
    });
    const stopIndex = (trip.tripStops || []).findIndex(
      (stop) => stop.status !== TripStopStatus.Completed,
    );

    if (stopIndex < 0) {
      throw new BadRequestException('trip has no pending stop');
    }

    const updatedTrip = await this.db.findAndUpdateOrFail<TripDocument>(
      this.db.trips,
      { _id: trip.id, driver: driver.id, status: TripStatus.InProgress },
      {
        $set: {
          [`tripStops.${stopIndex}.status`]: TripStopStatus.Completed,
        },
      },
      {
        populate: [{ path: 'user' }, { path: 'driver' }],
        options: { upsert: false, new: true },
        error: new NotFoundException('trip not found'),
      },
    );

    this.websocket.emitToUser(
      updatedTrip.user as UserDocument,
      'TripInProgress',
      updatedTrip,
    );
    this.websocket.emitToUser(
      updatedTrip.driver as UserDocument,
      'TripInProgress',
      updatedTrip,
    );

    return updatedTrip;
  }

  private async endTripEarly(
    endedBy: UserDocument,
    trip: TripDocument,
    reason: string,
  ) {
    const driver = trip.driver as UserDocument;
    const ride = trip.ride as RidesDocument;
    const endedAt = new Date();
    const isPlayReviewSynthetic = trip.meta?.playReviewSynthetic === true;

    if (isPlayReviewSynthetic) {
      return this.completeTrip(trip, driver, {
        endedAt,
        endedBy,
        endReason: reason,
        partialDistance: 0,
        partialDuration: 0,
      });
    }

    const live = this.websocket.getLastRideLocation(trip.id);
    const persisted = ride.location;
    const latitude = live?.lat ?? persisted?.coordinates?.[0];
    const longitude = live?.lon ?? persisted?.coordinates?.[1];
    const recordedAtValue =
      live?.recordedAt ?? live?.updatedAt ?? persisted?.recordedAt;
    const recordedAt = recordedAtValue ? new Date(recordedAtValue) : null;

    if (
      typeof latitude !== 'number' ||
      typeof longitude !== 'number' ||
      !recordedAt ||
      !Number.isFinite(recordedAt.getTime()) ||
      endedAt.getTime() - recordedAt.getTime() > EARLY_END_LOCATION_MAX_AGE_MS
    ) {
      throw new BadRequestException(
        'Current driver location is unavailable. Please try again shortly.',
      );
    }

    const from = trip.from?.coordinates;
    if (
      !Array.isArray(from) ||
      typeof from[0] !== 'number' ||
      typeof from[1] !== 'number'
    ) {
      throw new BadRequestException('Trip pickup location is unavailable');
    }

    const route = await GeolocationService.getRouteSummary(from, [
      latitude,
      longitude,
    ]);
    const startedAt = trip.startedAt ? new Date(trip.startedAt) : endedAt;
    const duration = Math.max(
      0,
      Math.round((endedAt.getTime() - startedAt.getTime()) / 1000),
    );

    return this.completeTrip(trip, driver, {
      endedAt,
      endedBy,
      endLocation: {
        type: 'Point',
        coordinates: [latitude, longitude],
        accuracy: live?.accuracy ?? persisted?.accuracy,
        heading: live?.heading ?? persisted?.heading,
        recordedAt,
      },
      endReason: reason,
      partialDistance: route.distance,
      partialDuration: duration,
    });
  }

  private async completeTrip(
    trip: TripDocument,
    driver: UserDocument,
    options: TripCompletionOptions = {},
  ) {
    const user = trip.user as UserDocument;
    const ride = trip.ride as RidesDocument;
    const rideId = typeof trip.ride === 'string' ? trip.ride : trip.ride.id;
    let status = TripStatus.Completed;
    let paymentResponse: unknown;
    let paymentError: string;
    let distance = options.partialDistance ?? trip.distance;

    if (
      options.partialDistance === undefined &&
      trip.meta?.bookedStopsIncludedInFare !== true
    ) {
      trip.tripStops.forEach((stop) => {
        distance += stop?.distance || 0;
      });
    }

    const isPlayReviewSynthetic = trip.meta?.playReviewSynthetic === true;
    const stopsDistance = distance - trip.distance;
    let amount = 0;
    if (!isPlayReviewSynthetic) {
      if (
        options.partialDistance !== undefined &&
        options.partialDuration !== undefined &&
        trip.fare
      ) {
        amount = PricingService.calculateFare(
          trip.fare,
          options.partialDistance,
          options.partialDuration,
        );
      } else if (
        options.partialDistance !== undefined &&
        options.partialDuration !== undefined
      ) {
        const [fromLat, fromLon] = trip.from?.coordinates ?? [];
        const partialFare = await this.pricing.fareFor(
          ride.type,
          options.partialDistance,
          options.partialDuration,
          [fromLat, fromLon],
        );
        amount = partialFare.amount;
      } else if (trip.fare?.amount > 0) {
        // Charge the booked price, plus any stops added on the way at the booked rate.
        amount = PricingService.chargeForTrip(trip.fare, stopsDistance);
      } else {
        // Trips booked before prices were locked at booking.
        const [fromLat, fromLon] = trip.from?.coordinates ?? [];
        const quotes = await this.getRideQuotes({ distance, fromLat, fromLon });
        amount = quotes[ride.type.toLocaleLowerCase()] || 0;
      }
    }

    if (!isPlayReviewSynthetic) {
      await this.paymentService
        .chargeUser(user, {
          amount,
          method: trip.paymentMethod,
        })
        .then((response) => {
          paymentResponse = response;
        })
        .catch((error) => {
          paymentError = error.message;
          status = TripStatus.PaymentFailed;
        });
    }

    const completedTrip = await Promise.all([
      this.db.trips.findOneAndUpdate(
        { _id: trip.id, status: TripStatus.InProgress },
        {
          $set: {
            status,
            endedAt: options.endedAt ?? new Date(),
            ...(options.endedBy
              ? {
                  endedEarly: true,
                  endedBy: options.endedBy.id,
                  endReason: options.endReason,
                  ...(options.endLocation
                    ? { endLocation: options.endLocation }
                    : {}),
                }
              : {}),
            meta: {
              ...(trip.meta || {}),
              paymentResponse,
              paymentError,
              amount,
              distance,
              ...(options.partialDuration !== undefined
                ? { durationSeconds: options.partialDuration }
                : {}),
            },
          },
        },
        { new: true, upsert: false },
      ),
      this.db.rides.updateOne(
        { _id: rideId },
        { $set: { status: RideStatus.Online } },
      ),
    ]).then(([updated]) => updated);

    if (!completedTrip) {
      throw new ConflictException('Trip has already ended');
    }

    trip = completedTrip;

    await this.openOnlineSession(driver.id, String(rideId));

    const paymentSucceeded = status === TripStatus.Completed;
    if (!isPlayReviewSynthetic) {
      await this.activityLedger.recordActivity({
        type: paymentSucceeded
          ? ActivityType.PaymentSucceeded
          : ActivityType.PaymentFailed,
        title: this.activityLedger.paymentActivityTitle(
          trip.paymentMethod,
          paymentSucceeded,
        ),
        meta: this.activityLedger.formatAmountMeta(amount),
        amount,
        user: user.id,
        trip: trip.id,
      });
    }

    if (paymentSucceeded && !isPlayReviewSynthetic) {
      await this.activityLedger.recordDriverEarning({
        driver: driver.id,
        trip: trip.id,
        amount,
        paymentMethod: trip.paymentMethod,
        // The commission agreed when the ride was booked.
        commissionRate:
          typeof trip.fare?.commissionPercent === 'number'
            ? trip.fare.commissionPercent / 100
            : undefined,
      });
      if (trip.paymentMethod === PaymentMethod.Cash) {
        const financialState = await this.finance.ensureDriverRestrictionState(
          driver.id,
        );
        if (financialState.restricted) {
          await Promise.all([
            this.db.rides.updateMany(
              {
                driver: driver.id,
                type: { $ne: RideType.Hire },
                deleted: { $ne: true },
              },
              { $set: { status: RideStatus.Offline } },
            ),
            this.closeOnlineSession(driver.id),
          ]);
        }
      }
    }

    const event = paymentSucceeded ? 'TripEnded' : 'PaymentFailed';
    const endedByDriver =
      options.endedBy && String(options.endedBy.id) === String(driver.id);

    this.websocket.emitToUser(user, event, trip);
    this.websocket.emitToUser(driver, event, trip);

    if (paymentSucceeded && !isPlayReviewSynthetic) {
      this.push.sendToUser(user, {
        title: endedByDriver
          ? 'Trip ended by driver'
          : options.endedBy
          ? 'Trip ended early'
          : 'Trip completed',
        body: options.endedBy
          ? 'Your final fare was calculated for where the trip ended'
          : 'Thanks for riding with Ritz',
        app: 'rider',
        data: {
          type: 'TripEnded',
          tripId: String(trip.id),
        },
      });
      this.push.sendToUser(driver, {
        title: endedByDriver
          ? 'Trip ended early'
          : options.endedBy
          ? 'Trip ended by rider'
          : 'Trip completed',
        body: endedByDriver
          ? 'The final fare was calculated for where the trip ended'
          : options.endedBy
          ? 'The rider ended this trip early'
          : 'Trip finished successfully',
        app: 'driver',
        data: {
          type: 'TripEnded',
          tripId: String(trip.id),
        },
      });
    } else if (!isPlayReviewSynthetic) {
      this.push.sendToUser(user, {
        title: 'Payment failed',
        body: 'We could not charge your payment method',
        app: 'rider',
        data: {
          type: 'PaymentFailed',
          tripId: String(trip.id),
        },
      });
    }

    return trip;
  }

  async getTripHistory(user: UserDocument, payload: GetTripHistoryDTO) {
    const { page = 1, limit = 100, role } = payload;
    const ownership =
      role === 'driver' ? { driver: user.id } : { user: user.id };
    const hideSyntheticReviewerTrips =
      role === 'driver' && getPlayReviewAccount(user.email)?.kind === 'driver'
        ? { 'meta.playReviewSynthetic': { $ne: true } }
        : {};

    return this.db.trips.paginate(
      {
        ...ownership,
        ...hideSyntheticReviewerTrips,
        deleted: { $ne: true },
      },
      {
        page,
        limit,
        sort: { createdAt: -1 },
        populate: [
          { path: 'user' },
          { path: 'driver' },
          { path: 'ride', populate: { path: 'driver' } },
        ],
      },
    );
  }

  async getUserTrip(user: UserDocument, tripId: string) {
    const trip = await this.db.trips
      .findOne({
        _id: tripId,
        $or: [{ user: user.id }, { driver: user.id }],
        deleted: { $ne: true },
      })
      .populate('user')
      .populate('driver')
      .populate({ path: 'ride', populate: { path: 'driver' } });

    if (!trip) {
      throw new NotFoundException('trip not found');
    }

    return trip;
  }

  async rateTrip(user: UserDocument, tripId: string, rating: Rating) {
    return this.db.findAndUpdateOrFail<TripDocument>(
      this.db.trips,
      {
        _id: tripId,
        user: user.id,
        status: { $in: [TripStatus.Completed, TripStatus.PaymentFailed] },
        rating: { $exists: false },
      },
      { $set: { rating } },
      {
        error: new NotFoundException('trip not found'),
        options: { upsert: false, new: true },
      },
    );
  }

  async ratePassenger(
    driver: UserDocument,
    tripId: string,
    rating: RatePassengerDTO,
  ) {
    return this.db.findAndUpdateOrFail<TripDocument>(
      this.db.trips,
      {
        _id: tripId,
        driver: driver.id,
        status: { $in: [TripStatus.Completed, TripStatus.PaymentFailed] },
        passengerRating: { $exists: false },
      },
      { $set: { passengerRating: rating } },
      {
        error: new NotFoundException(
          'completed trip not found or passenger already rated',
        ),
        options: { upsert: false, new: true },
      },
    );
  }

  async updateTripStops(
    user: UserDocument,
    tripId: string,
    stops: RideStopsDTO[],
  ) {
    const trip = await this.db.findOrFail<TripDocument>(this.db.trips, {
      _id: tripId,
      user: user.id,
      status: {
        $in: [
          TripStatus.InProgress,
          TripStatus.Started,
          TripStatus.DriverArrived,
        ],
      },
    });

    const completedTripStops = trip.tripStops.filter(
      (stop) => stop.status === TripStopStatus.Completed,
    );

    return this.db.findAndUpdateOrFail<TripDocument>(
      this.db.trips,
      { _id: trip.id },
      {
        $set: {
          tripStops: completedTripStops.concat(
            stops.map((stop) => ({
              to: { type: 'Point', coordinates: [stop.toLat, stop.toLon] },
              toAddress: stop.toAddress,
            })),
          ),
        },
      },
      {
        error: new NotFoundException('trip not found'),
        options: { upsert: false, new: true },
      },
    );
  }

  async getSingleRide(rideId: string) {
    const ride = await this.db.rides
      .findOne({
        _id: rideId,
        deleted: { $ne: true },
      })
      .populate('driver');

    if (!ride) {
      throw new NotFoundException('Ride not found');
    }

    const trips = await this.db.trips
      .find({
        driver: (ride.driver as UserDocument).id,
        deleted: { $ne: true },
        rating: { $exists: true },
      })
      .select('rating');

    let totalReviews = 0;
    let sum = 0;

    trips.forEach((trip) => {
      if (trip.rating) {
        sum += Math.abs(trip.rating.rating);
        totalReviews += 1;
      }
    });

    return { ride, totalReviews, rating: sum / Math.min(1, totalReviews) };
  }

  async getRentalCarBrands(payload: PaginationRequestDTO) {
    const { page = 1, limit = 100 } = payload;
    const $skip = (page - 1) * limit;
    const all = [
      {
        $match: {
          deleted: { $ne: true },
          'specs.synthetic': { $ne: true },
          status: { $in: [RideStatus.Online, RideStatus.FinishingTrip] },
          type: RideType.Hire,
        },
      },
      {
        $project: {
          brand: '$brand',
          createdAt: 1,
        },
      },
      {
        $group: {
          _id: '$brand',
          brand: { $first: '$brand' },
          count: { $sum: 1 },
          createdAt: { $last: '$createdAt' },
        },
      },
    ];

    const [brands, totalBrands, logoUrls] = await Promise.all([
      this.db.rides.aggregate([
        ...all,
        { $sort: { createdAt: -1 } },
        { $skip },
        { $limit: limit },
      ]),
      this.db.rides.aggregate([...all]),
      this.getCarBrandLogoUrls(),
    ]);
    const data = brands.map((brand) => ({
      ...brand,
      logoUrl: logoUrls.get(toCarBrandSlug(brand.brand)) ?? null,
    }));

    const totalDocs = totalBrands.length;
    const totalPages = Math.round(totalDocs / limit);
    const pagingCounter = $skip + 1;
    const hasPrevPage = page > 1 && page < totalPages;
    const hasNextPage = page < totalPages;
    const prevPage = hasPrevPage ? page - 1 : null;
    const nextPage = hasNextPage ? page + 1 : null;

    return {
      data,
      meta: {
        totalDocs,
        totalPages,
        pagingCounter,
        hasPrevPage,
        hasNextPage,
        prevPage,
        nextPage,
        limit,
        page,
      },
    };
  }

  async getOngoingRental(
    user: UserDocument,
    payload: Pick<HireRideDTO, 'checkInAt' | 'checkOutAt'> = {},
  ) {
    const { checkInAt, checkOutAt } = payload;
    const openStatuses = [
      RentalStatus.Pending,
      RentalStatus.Accepted,
      RentalStatus.InProgress,
    ];

    const query: FilterQuery<RentalDocument> = {
      user: user.id,
      deleted: { $ne: true },
      status: { $in: openStatuses },
    };

    // Overlap check only when booking (dates provided). Listing "ongoing"
    // must return any open rental — including Hourly Pending — without dates.
    const checkIn = checkInAt ? new Date(checkInAt) : null;
    const checkOut = checkOutAt ? new Date(checkOutAt) : null;
    if (
      checkIn &&
      checkOut &&
      !Number.isNaN(checkIn.getTime()) &&
      !Number.isNaN(checkOut.getTime())
    ) {
      query.$or = [
        { checkInAt: { $lte: checkIn }, checkOutAt: { $gte: checkIn } },
        { checkInAt: { $lte: checkOut }, checkOutAt: { $gte: checkOut } },
        { checkInAt: { $gte: checkIn }, checkOutAt: { $lte: checkOut } },
      ];
    }

    return this.db.rentals
      .findOne(query)
      .sort({ createdAt: -1 })
      .populate(RIDER_RENTAL_POPULATE);
  }

  async hireARide(user: UserDocument, payload: HireRideDTO) {
    const reviewerAccount = getPlayReviewAccount(user.email);
    if (reviewerAccount?.kind === 'rider') {
      return this.createPlayReviewRental(user, payload);
    }
    if (reviewerAccount) {
      this.rejectPlayReviewerRealWorldAction(user);
    }
    const { ride: rideId, checkInAt, checkOutAt, billingType } = payload;
    const ongoingRental = await this.getOngoingRental(user, payload);
    if (ongoingRental) {
      return ongoingRental;
    }

    const ride = await this.db.rides.findOne({
      _id: rideId,
      status: { $nin: [RideStatus.Busy, RideStatus.Offline] },
    });
    if (!ride) {
      throw new NotFoundException('Ride not found');
    }
    const ownerId = Util.resolveDocumentId(ride.driver);
    if (
      ownerId &&
      (await this.isUserPairBlocked(String(user.id), String(ownerId)))
    ) {
      throw new NotFoundException('Ride not found');
    }

    if (!checkInAt || !checkOutAt) {
      throw new BadRequestException(
        'Provide check in and out dates for hire bookings',
      );
    }

    const checkIn = new Date(checkInAt);
    const checkOut = new Date(checkOutAt);
    if (
      Number.isNaN(checkIn.getTime()) ||
      Number.isNaN(checkOut.getTime()) ||
      checkOut.getTime() <= checkIn.getTime()
    ) {
      throw new BadRequestException('Invalid check in / check out window');
    }

    const query: FilterQuery<RentalDocument> = {
      'meta.playReviewSynthetic': { $ne: true },
      ride: ride.id,
      status: {
        $nin: [
          RentalStatus.Cancelled,
          RentalStatus.Completed,
          RentalStatus.Rejected,
        ],
      },
      $or: [
        { checkInAt: { $lte: checkIn }, checkOutAt: { $gte: checkIn } },
        { checkInAt: { $lte: checkOut }, checkOutAt: { $gte: checkOut } },
        { checkInAt: { $gte: checkIn }, checkOutAt: { $lte: checkOut } },
      ],
    };

    const rideRented = await this.db.rentals.exists(query);
    if (rideRented) {
      throw new BadRequestException(
        'Ride is unavailable for selected check in and out period',
      );
    }

    const pricing = this.calculateHireBookingTotals(ride, {
      billingType,
      checkInAt: checkIn,
      checkOutAt: checkOut,
    });
    if (pricing.price <= 0) {
      throw new BadRequestException('Invalid hire price for this booking');
    }

    const chargeMethod = await this.resolveHireChargeMethod(
      user,
      payload.paymentMethod,
    );

    const paymentResponse = await this.paymentService.chargeUser(user, {
      amount: pricing.price,
      method: chargeMethod.chargeWith,
    });

    const rental = await this.db.rentals.create({
      ...payload,
      ride,
      user: user.id,
      driver: ride.driver,
      paymentMethod: chargeMethod.storedMethod,
      price: pricing.price,
      hireFee: pricing.hireFee,
      cautionAmount: pricing.cautionAmount,
      insuranceFee: pricing.insuranceFee,
      checkInAt: checkIn,
      checkOutAt: checkOut,
      meta: {
        paymentResponse,
        durationUnits: pricing.durationUnits,
        unitRate: pricing.unitRate,
      },
    });

    if (ownerId) {
      const owner = await this.db.users.findById(ownerId);
      if (owner) {
        this.push.sendToUser(owner, {
          title: 'New car hire booking',
          body: 'A rider booked one of your cars. Open Car hire to accept or reject.',
          app: 'driver',
          data: {
            type: 'RentalPending',
            rentalId: String(rental.id),
          },
        });
      }
    }

    return rental;
  }

  private async createPlayReviewRental(
    user: UserDocument,
    payload: HireRideDTO,
  ) {
    const ongoingRental = await this.getOngoingRental(user, payload);
    if (ongoingRental) {
      return ongoingRental;
    }

    const ride = await this.db.rides.findOne({
      _id: payload.ride,
      deleted: { $ne: true },
      'specs.synthetic': true,
      type: RideType.Hire,
    });
    if (!ride) {
      throw new NotFoundException('Ride not found');
    }

    const checkIn = payload.checkInAt ? new Date(payload.checkInAt) : null;
    const checkOut = payload.checkOutAt ? new Date(payload.checkOutAt) : null;
    if (
      !checkIn ||
      !checkOut ||
      Number.isNaN(checkIn.getTime()) ||
      Number.isNaN(checkOut.getTime()) ||
      checkOut.getTime() <= checkIn.getTime()
    ) {
      throw new BadRequestException('Invalid check in / check out window');
    }

    const quotedPricing = this.calculateHireBookingTotals(ride, {
      billingType: payload.billingType,
      checkInAt: checkIn,
      checkOutAt: checkOut,
    });

    return this.db.rentals.create({
      ...payload,
      cautionAmount: 0,
      checkInAt: checkIn,
      checkOutAt: checkOut,
      driver: ride.driver,
      hireFee: 0,
      insuranceFee: 0,
      meta: {
        playReviewSynthetic: true,
        quotedPricing,
      },
      paymentMethod: payload.paymentMethod,
      price: 0,
      ride,
      status: RentalStatus.Pending,
      user: user.id,
    });
  }

  private calculateHireBookingTotals(
    ride: RidesDocument,
    payload: {
      billingType: RentalBillingType;
      checkInAt: Date;
      checkOutAt: Date;
    },
  ) {
    const ms = payload.checkOutAt.getTime() - payload.checkInAt.getTime();
    const durationUnits =
      payload.billingType === RentalBillingType.Daily
        ? Math.ceil(ms / (1000 * 3600 * 24))
        : Math.ceil(ms / (1000 * 3600));

    const units = Math.max(1, durationUnits);
    const unitRate =
      payload.billingType === RentalBillingType.Daily
        ? Number(ride.dailyRate) || 0
        : Number(ride.hourlyRate) || 0;
    const hireFee = Math.round(unitRate * units * 100) / 100;
    const cautionAmount = Math.round(hireFee * 0.2 * 100) / 100;
    const insuranceFee = Math.max(0, Number(ride.insuranceFee) || 0);
    const price =
      Math.round((hireFee + cautionAmount + insuranceFee) * 100) / 100;

    return {
      durationUnits: units,
      unitRate,
      hireFee,
      cautionAmount,
      insuranceFee,
      price,
    };
  }

  private async resolveHireChargeMethod(
    user: UserDocument,
    paymentMethod: PaymentMethod | string,
  ) {
    if (paymentMethod === PaymentMethod.Cash) {
      throw new BadRequestException('Cash is not supported for hire bookings');
    }

    if (paymentMethod === PaymentMethod.RULBalance) {
      return {
        chargeWith: PaymentMethod.RULBalance,
        storedMethod: PaymentMethod.RULBalance,
      };
    }

    let cardId = String(paymentMethod);
    if (paymentMethod === PaymentMethod.Card || !isMongoId(cardId)) {
      const card = await this.db.cards.findOne({
        user: user.id,
        isDefault: true,
        deleted: { $ne: true },
      });
      if (!card) {
        throw new BadRequestException('no/invalid card setup');
      }
      cardId = String(card.id);
    } else {
      const card = await this.db.cards.findOne({
        _id: cardId,
        user: user.id,
        deleted: { $ne: true },
      });
      if (!card) {
        throw new BadRequestException('no/invalid card setup');
      }
      cardId = String(card.id);
    }

    return {
      chargeWith: cardId,
      storedMethod: PaymentMethod.Card,
    };
  }

  private assertRideImages(
    images: string[] | undefined,
    { required }: { required: boolean },
  ) {
    if (!required && images === undefined) {
      return;
    }

    if (!Array.isArray(images) || images.length < 1) {
      throw new BadRequestException('Cars require at least 1 photo');
    }

    if (images.length > MAX_HIRE_RIDE_IMAGES) {
      throw new BadRequestException(
        `Cars allow at most ${MAX_HIRE_RIDE_IMAGES} photos`,
      );
    }

    if (
      !images.every((url) => typeof url === 'string' && url.trim().length > 0)
    ) {
      throw new BadRequestException('Each car photo must be a valid URL');
    }
  }

  private buildRidePayload(
    user: UserDocument,
    payload: CreateRideDTO | UpdateRideDTO,
    defaults: {
      type?: RideType;
      status?: RideStatus;
      approvalStatus?: RideApprovalStatus;
    } = {},
  ) {
    const requestedSeats = Number(payload.specs?.seats);
    const seats =
      Number.isFinite(requestedSeats) && requestedSeats > 0
        ? Math.min(12, Math.round(requestedSeats))
        : 4;

    const type = payload.type || defaults.type || RideType.Classic;
    const claimedCategory =
      payload.claimedCategory ||
      (type === RideType.Luxury
        ? VehicleCategory.Luxury
        : VehicleCategory.Classic);
    const doc: Record<string, unknown> = {
      ...payload,
      driver: user.id,
      type,
      claimedCategory,
      specs: {
        ...(payload.specs || {}),
        seats,
        ...(getPlayReviewAccount(user.email) ? { synthetic: true } : {}),
      },
    };

    if (defaults.status) {
      doc.status = defaults.status;
    }
    if (defaults.approvalStatus) {
      doc.approvalStatus = defaults.approvalStatus;
    }

    if (type === RideType.Hire) {
      doc.vehicleCategory = claimedCategory;
      const dailyRate = Number(payload.dailyRate);
      const hourlyRate = Number(payload.hourlyRate);
      const baseRate =
        Number.isFinite(dailyRate) && dailyRate > 0
          ? dailyRate
          : Number.isFinite(hourlyRate) && hourlyRate > 0
          ? hourlyRate
          : 0;
      // Platform rule: caution is always 20% of the owner's listed rate.
      doc.cautionDeposit = Math.round(baseRate * 0.2 * 100) / 100;
      // Insurance is optional — default to 0 when omitted.
      if (
        payload.insuranceFee === undefined ||
        payload.insuranceFee === null ||
        !Number.isFinite(Number(payload.insuranceFee))
      ) {
        doc.insuranceFee = 0;
      }
    }

    if (defaults.status) {
      doc.status = defaults.status;
    }
    if (defaults.approvalStatus) {
      doc.approvalStatus = defaults.approvalStatus;
    }

    return doc;
  }

  async createRide(user: UserDocument, payload: CreateRideDTO) {
    const type = payload.type || RideType.Classic;
    this.assertRideImages(payload.images, { required: true });
    const doc = this.buildRidePayload(user, payload, {
      type,
      status: RideStatus.Offline,
      approvalStatus:
        type === RideType.Hire
          ? RideApprovalStatus.Approved
          : RideApprovalStatus.Pending,
    });

    // Hire fleet and trip vehicles: many cars per owner (insert, not upsert).
    if (type === RideType.Hire && !payload.location) {
      const tripVehicle = await this.db.rides.findOne({
        driver: user.id,
        type: { $ne: RideType.Hire },
        deleted: { $ne: true },
        location: { $exists: true },
      });
      if (tripVehicle?.location) {
        doc.location = tripVehicle.location;
      }
    }

    return this.db.rides.create(doc);
  }

  async createOnboardingRide(
    user: UserDocument,
    payload: Omit<CreateRideDTO, 'type'>,
  ) {
    if (
      !Array.isArray(payload.images) ||
      payload.images.length < 2 ||
      payload.images.length > 8 ||
      !payload.images.every(
        (url) => typeof url === 'string' && url.trim().length > 0,
      )
    ) {
      throw new BadRequestException(
        'Onboarding requires valid interior and exterior vehicle photos',
      );
    }
    const registration = payload.registration.trim().toLocaleUpperCase();
    const claimedCategory = payload.claimedCategory || VehicleCategory.Classic;
    const requestedType =
      claimedCategory === VehicleCategory.Luxury
        ? RideType.Luxury
        : RideType.Classic;
    const existing = await this.db.rides.findOne({
      driver: user.id,
      registration,
      type: requestedType,
      deleted: { $ne: true },
    });
    if (existing) return existing;

    const doc = this.buildRidePayload(
      user,
      { ...payload, claimedCategory, registration, type: requestedType },
      {
        type: requestedType,
        status: RideStatus.Offline,
        approvalStatus: RideApprovalStatus.Pending,
      },
    );
    return this.db.rides.create(doc);
  }

  async getMyRides(user: UserDocument, type?: RideType) {
    const query: FilterQuery<RidesDocument> = {
      driver: user.id,
      deleted: { $ne: true },
    };
    if (type) {
      query.type = type;
    }

    return this.db.rides.find(query).sort({ createdAt: -1 });
  }

  async getMyRide(user: UserDocument, rideId: string) {
    const ride = await this.db.rides.findOne({
      _id: rideId,
      driver: user.id,
      deleted: { $ne: true },
    });
    if (!ride) {
      throw new NotFoundException('Ride not found');
    }
    return ride;
  }

  async updateRide(user: UserDocument, rideId: string, payload: UpdateRideDTO) {
    const ride = await this.getMyRide(user, rideId);
    this.assertRideImages(payload.images, {
      required: payload.images !== undefined,
    });
    if (
      payload.images === undefined &&
      (!ride.images || ride.images.length < 1)
    ) {
      throw new BadRequestException('Cars require at least 1 photo');
    }
    const requestedClaim = payload.claimedCategory;
    const $set = this.buildRidePayload(
      user,
      { ...payload, type: ride.type },
      { type: ride.type },
    );
    // Never overwrite ownership or soft-delete via update
    delete $set.driver;
    delete $set.vehicleCategory;
    $set.type = ride.type;
    if (
      ride.type !== RideType.Hire &&
      requestedClaim &&
      requestedClaim !== ride.claimedCategory
    ) {
      $set.approvalStatus = RideApprovalStatus.Pending;
      $set.status = RideStatus.Offline;
      $set.type =
        requestedClaim === VehicleCategory.Luxury
          ? RideType.Luxury
          : RideType.Classic;
      delete $set.vehicleCategory;
    }

    const update: Record<string, unknown> = { $set };
    if (
      ride.type !== RideType.Hire &&
      requestedClaim &&
      requestedClaim !== ride.claimedCategory
    ) {
      update.$unset = {
        vehicleCategory: 1,
        categoryReviewedBy: 1,
        categoryReviewedAt: 1,
      };
    }

    return this.db.rides.findOneAndUpdate({ _id: ride.id }, update, {
      new: true,
    });
  }

  async deleteMyRide(user: UserDocument, rideId: string) {
    const ride = await this.getMyRide(user, rideId);

    if (
      ride.status === RideStatus.Busy ||
      ride.status === RideStatus.FinishingTrip ||
      ride.status === RideStatus.Online
    ) {
      throw new BadRequestException(
        ride.type === RideType.Hire
          ? 'Cannot delete a car that is listed or rented'
          : 'Cannot delete a vehicle that is online or on a trip',
      );
    }

    if (ride.type === RideType.Hire) {
      const activeRental = await this.db.rentals.exists({
        ride: ride.id,
        status: {
          $in: [
            RentalStatus.Pending,
            RentalStatus.Accepted,
            RentalStatus.InProgress,
          ],
        },
        deleted: { $ne: true },
      });
      if (activeRental) {
        throw new BadRequestException(
          'Cannot delete a car with an active rental booking',
        );
      }
    } else {
      const activeTrip = await this.db.trips.exists({
        ride: ride.id,
        status: { $nin: InactiveTripStatuses },
        deleted: { $ne: true },
      });
      if (activeTrip) {
        throw new BadRequestException(
          'Cannot delete a vehicle with an active trip',
        );
      }
    }

    return this.db.rides.findOneAndUpdate(
      { _id: ride.id },
      { $set: { deleted: true, status: RideStatus.Offline } },
      { new: true },
    );
  }

  async setRideAvailability(
    user: UserDocument,
    status: RideStatus.Online | RideStatus.Offline,
    rideId?: string,
  ) {
    const explicitRideQuery = rideId
      ? {
          _id: rideId,
          deleted: { $ne: true },
          driver: user.id,
        }
      : null;
    const approvedTripRideQuery = {
      approvalStatus: RideApprovalStatus.Approved,
      deleted: { $ne: true },
      driver: user.id,
      type: { $ne: RideType.Hire },
    };

    let ride = explicitRideQuery
      ? await this.db.rides.findOne(explicitRideQuery)
      : await this.db.rides.findOne({
          ...approvedTripRideQuery,
          status:
            status === RideStatus.Offline
              ? RideStatus.Online
              : { $in: [RideStatus.Online, RideStatus.Offline] },
        });

    // Going offline is idempotent even when every approved vehicle is already
    // offline. Returning one also keeps the endpoint response shape unchanged.
    if (!ride && !rideId && status === RideStatus.Offline) {
      ride = await this.db.rides.findOne({
        ...approvedTripRideQuery,
        status: RideStatus.Offline,
      });
    }

    if (!ride) {
      throw new BadRequestException(
        rideId ? 'Ride not found' : 'No approved trip vehicle found',
      );
    }

    if (
      status === RideStatus.Online &&
      ride.type !== RideType.Hire &&
      !getPlayReviewAccount(user.email) &&
      !(await this.finance.canDriverReceiveRides(user.id))
    ) {
      throw new BadRequestException(
        'Pay the required cash-trip commission deposit before going online',
      );
    }

    if (
      ride.status === RideStatus.Busy ||
      ride.status === RideStatus.FinishingTrip
    ) {
      throw new BadRequestException(
        ride.type === RideType.Hire
          ? 'cannot change availability while this car is rented'
          : 'cannot change availability while on an active trip',
      );
    }

    if (ride.type === RideType.Hire) {
      const inProgress = await this.db.rentals.exists({
        ride: ride.id,
        status: RentalStatus.InProgress,
        deleted: { $ne: true },
      });
      if (inProgress) {
        throw new BadRequestException(
          'cannot change availability while this car is rented',
        );
      }
    } else if (
      status === RideStatus.Online &&
      ride.approvalStatus !== RideApprovalStatus.Approved
    ) {
      throw new BadRequestException(
        ride.approvalStatus === RideApprovalStatus.Rejected
          ? 'this vehicle was rejected and cannot go online'
          : 'this vehicle is awaiting admin approval',
      );
    }

    if (ride.status === status) {
      return ride;
    }

    const $set: Record<string, unknown> = { status };
    if (getPlayReviewAccount(user.email)) {
      $set['specs.synthetic'] = true;
    }
    if (
      status === RideStatus.Online &&
      ride.type === RideType.Hire &&
      !ride.location
    ) {
      const tripVehicle = await this.db.rides.findOne({
        driver: user.id,
        type: { $ne: RideType.Hire },
        deleted: { $ne: true },
        location: { $exists: true },
      });
      if (tripVehicle?.location) {
        $set.location = tripVehicle.location;
      }
    }

    const updated = await this.db.rides.findOneAndUpdate(
      { _id: ride.id },
      { $set },
      { new: true },
    );

    if (ride.type !== RideType.Hire && status === RideStatus.Online) {
      await this.db.rides.updateMany(
        {
          driver: user.id,
          type: { $ne: RideType.Hire },
          deleted: { $ne: true },
          _id: { $ne: ride.id },
          status: RideStatus.Online,
        },
        { $set: { status: RideStatus.Offline } },
      );
      await this.openOnlineSession(user.id, ride.id);
    } else if (ride.type !== RideType.Hire && status === RideStatus.Offline) {
      await this.closeOnlineSession(user.id);
    }

    return updated;
  }

  private async syncHireRideAvailability(
    rideId: string | RidesDocument,
    rentalStatus: RentalStatus,
  ) {
    const id =
      typeof rideId === 'string' ? rideId : rideId?.id || String(rideId);
    if (!id) {
      return;
    }

    if (rentalStatus === RentalStatus.InProgress) {
      await this.db.rides.updateOne(
        { _id: id, type: RideType.Hire, deleted: { $ne: true } },
        { $set: { status: RideStatus.Busy } },
      );
      return;
    }

    if (
      rentalStatus === RentalStatus.Completed ||
      rentalStatus === RentalStatus.Cancelled ||
      rentalStatus === RentalStatus.Rejected
    ) {
      const otherActive = await this.db.rentals.exists({
        ride: id,
        status: RentalStatus.InProgress,
        deleted: { $ne: true },
      });
      if (!otherActive) {
        await this.db.rides.updateOne(
          {
            _id: id,
            type: RideType.Hire,
            deleted: { $ne: true },
            status: RideStatus.Busy,
          },
          { $set: { status: RideStatus.Online } },
        );
      }
    }
  }

  private async recordRideOffer(payload: {
    driverId: string;
    rideId: string;
    requestedCategory: VehicleCategory;
    userId: string;
    trackingId: string;
  }) {
    await this.db.driverRideOffers.updateOne(
      { trackingId: payload.trackingId },
      {
        $setOnInsert: {
          driver: payload.driverId,
          ride: payload.rideId,
          requestedCategory: payload.requestedCategory,
          user: payload.userId,
          trackingId: payload.trackingId,
          offeredAt: new Date(),
          outcome: RideOfferOutcome.Pending,
        },
      },
      { upsert: true },
    );
  }

  private async resolveRideOffer(
    trackingId: string,
    outcome: RideOfferOutcome,
    extras: { tripId?: string } = {},
  ) {
    try {
      const update: Record<string, unknown> = {
        outcome,
        resolvedAt: new Date(),
      };
      if (extras.tripId) {
        update.trip = extras.tripId;
      }
      await this.db.driverRideOffers.updateOne(
        {
          trackingId,
          outcome: RideOfferOutcome.Pending,
        },
        { $set: update },
      );
    } catch {
      // best-effort stats persistence
    }
  }

  private async openOnlineSession(driverId: string, rideId: string) {
    try {
      await this.closeOnlineSession(driverId);
      await this.db.driverOnlineSessions.create({
        driver: driverId,
        ride: rideId,
        startedAt: new Date(),
      });
    } catch {
      // best-effort stats persistence
    }
  }

  private async closeOnlineSession(driverId: string) {
    try {
      await this.db.driverOnlineSessions.updateMany(
        { driver: driverId, endedAt: { $exists: false } },
        { $set: { endedAt: new Date() } },
      );
    } catch {
      // best-effort stats persistence
    }
  }

  async getCarBrands() {
    const [brands, logoUrls] = await Promise.all([
      this.db.carBrands.find({ deleted: { $ne: true } }),
      this.getCarBrandLogoUrls(),
    ]);

    return brands.map((brand) => ({
      ...brand.toJSON(),
      logoUrl: logoUrls.get(toCarBrandSlug(brand.manufacturer)) ?? null,
    }));
  }

  // Logo url per brand slug, for attaching logos to brand listings.
  private async getCarBrandLogoUrls() {
    const logos = await this.db.carBrandLogos.find({ deleted: { $ne: true } });

    return new Map(logos.map((logo) => [logo.slug, logo.logoUrl]));
  }

  async getCarBrandLogos() {
    return this.db.carBrandLogos
      .find({ deleted: { $ne: true } })
      .sort({ name: 1 });
  }

  async createCarBrandLogo(payload: AdminCarBrandLogoDTO) {
    const slug = toCarBrandSlug(payload.name);
    const duplicate = await this.db.carBrandLogos.exists({
      slug,
      deleted: { $ne: true },
    });
    if (duplicate) throw new ConflictException('car brand logo already exists');
    return this.db.carBrandLogos.create({
      name: payload.name.trim(),
      slug,
      logoUrl: payload.logoUrl.trim(),
    });
  }

  async updateCarBrandLogo(logoId: string, payload: AdminCarBrandLogoDTO) {
    if (!isValidObjectId(logoId)) {
      throw new NotFoundException('car brand logo not found');
    }
    const slug = toCarBrandSlug(payload.name);
    const duplicate = await this.db.carBrandLogos.exists({
      _id: { $ne: logoId },
      slug,
      deleted: { $ne: true },
    });
    if (duplicate) throw new ConflictException('car brand logo already exists');
    const logo = await this.db.carBrandLogos.findOneAndUpdate(
      { _id: logoId, deleted: { $ne: true } },
      {
        $set: {
          name: payload.name.trim(),
          slug,
          logoUrl: payload.logoUrl.trim(),
        },
      },
      { new: true },
    );
    if (!logo) throw new NotFoundException('car brand logo not found');
    return logo;
  }

  async deleteCarBrandLogo(logoId: string) {
    if (!isValidObjectId(logoId)) {
      throw new NotFoundException('car brand logo not found');
    }
    const logo = await this.db.carBrandLogos.findOneAndUpdate(
      { _id: logoId, deleted: { $ne: true } },
      { $set: { deleted: true } },
      { new: true },
    );
    if (!logo) throw new NotFoundException('car brand logo not found');
    return { id: logo.id, deleted: true };
  }

  async getAdminCarBrands() {
    return this.db.carBrands
      .find({ deleted: { $ne: true } })
      .sort({ manufacturer: 1, brand: 1, year: -1 });
  }

  async createCarBrand(payload: AdminCarBrandDTO) {
    const duplicate = await this.db.carBrands.exists({
      manufacturer: payload.manufacturer.trim(),
      brand: payload.brand.trim(),
      year: payload.year,
      deleted: { $ne: true },
    });
    if (duplicate)
      throw new ConflictException('car brand entry already exists');
    return this.db.carBrands.create({
      manufacturer: payload.manufacturer.trim(),
      brand: payload.brand.trim(),
      year: payload.year,
    });
  }

  async updateCarBrand(brandId: string, payload: AdminCarBrandDTO) {
    if (!isValidObjectId(brandId)) {
      throw new NotFoundException('car brand not found');
    }
    const brand = await this.db.carBrands.findOneAndUpdate(
      { _id: brandId, deleted: { $ne: true } },
      {
        $set: {
          manufacturer: payload.manufacturer.trim(),
          brand: payload.brand.trim(),
          year: payload.year,
        },
      },
      { new: true },
    );
    if (!brand) throw new NotFoundException('car brand not found');
    return brand;
  }

  async deleteCarBrand(brandId: string) {
    if (!isValidObjectId(brandId)) {
      throw new NotFoundException('car brand not found');
    }
    const brand = await this.db.carBrands.findOneAndUpdate(
      { _id: brandId, deleted: { $ne: true } },
      { $set: { deleted: true } },
      { new: true },
    );
    if (!brand) throw new NotFoundException('car brand not found');
    return { id: brand.id, deleted: true };
  }

  async getTrips(query: AdminGetTripsDTO) {
    const { page = 1, limit = 100, status, scope } = query;
    const q: FilterQuery<TripDocument> = { deleted: { $ne: true } };
    if (status) {
      q.status = { $in: Array.isArray(status) ? status : [status] };
    } else if (scope === 'running') {
      q.status = {
        $in: [
          TripStatus.Started,
          TripStatus.InProgress,
          TripStatus.DriverArrived,
        ],
      };
    } else if (scope === 'history') {
      q.status = { $in: InactiveTripStatuses };
    }

    return this.db.trips.paginate(q, {
      page,
      limit,
      populate: [
        { path: 'user', select: 'firstName lastName email phoneNumber' },
        { path: 'driver', select: 'firstName lastName email phoneNumber' },
        {
          path: 'ride',
          select: 'brand model registration color type images location',
        },
      ],
      sort: { createdAt: -1 },
    });
  }

  async getRentals(query: AdminGetRentalsDTO) {
    const { page = 1, limit = 100, status } = query;
    const q: FilterQuery<RentalDocument> = { deleted: { $ne: true } };
    if (status) {
      q.status = { $in: Array.isArray(status) ? status : [status] };
    }

    return this.db.rentals.paginate(q, {
      page,
      limit,
      populate: [
        { path: 'user', select: 'firstName lastName email phoneNumber' },
        { path: 'driver', select: 'firstName lastName email phoneNumber' },
        { path: 'ride' },
      ],
      sort: { createdAt: -1 },
    });
  }

  async getTrip(_id: string) {
    const trip = await this.db.trips
      .findOne({ _id })
      .populate('user driver ride');
    if (!trip) {
      throw new NotFoundException('Trip not found');
    }

    return trip;
  }

  async getRental(_id: string) {
    const rental = await this.db.rentals
      .findOne({ _id })
      .populate('user driver ride');
    if (!rental) {
      throw new NotFoundException('Rental not found');
    }

    return rental;
  }

  private getRentalUserId(rental: RentalDocument): string {
    // After populate(), prefer the original ref id — works even if the user
    // doc is missing (populate set null) or the virtual `id` is empty.
    const populatedId = rental.populated?.('user');
    if (populatedId) {
      return String(populatedId);
    }

    const user = rental.user as
      | UserDocument
      | Types.ObjectId
      | string
      | { _id?: unknown; id?: unknown }
      | null
      | undefined;

    if (!user) {
      return '';
    }

    if (typeof user === 'string') {
      return user.trim();
    }

    if (user instanceof Types.ObjectId) {
      return user.toHexString();
    }

    const fromId = (user as { id?: unknown }).id;
    if (typeof fromId === 'string' && fromId.trim()) {
      return fromId.trim();
    }
    if (fromId instanceof Types.ObjectId) {
      return fromId.toHexString();
    }

    const fromObjectId = (user as { _id?: unknown })._id;
    if (fromObjectId instanceof Types.ObjectId) {
      return fromObjectId.toHexString();
    }
    if (fromObjectId != null && String(fromObjectId).trim()) {
      return String(fromObjectId).trim();
    }

    const asString = String(user);
    return isMongoId(asString) ? asString : '';
  }

  private async emitRentalStatusUpdated(rental: RentalDocument) {
    const userId = this.getRentalUserId(rental);
    if (!userId) {
      return;
    }

    await this.websocket.emitToUser(
      userId,
      WebsocketEvent.RentalStatusUpdated,
      {
        rentalId: rental.id,
        status: rental.status,
        startedAt: rental.startedAt ?? null,
        endedAt: rental.endedAt ?? null,
        refundedAmount: rental.refundedAmount ?? 0,
        checkInAt: rental.checkInAt ?? null,
        checkOutAt: rental.checkOutAt ?? null,
        billingType: rental.billingType,
        price: rental.price,
      },
    );
  }

  private notifyRentalRider(
    rental: RentalDocument,
    kind: 'status' | 'refund',
    refundAmount?: number,
  ) {
    const userId = this.getRentalUserId(rental);
    if (!userId) {
      return;
    }

    const rentalId = String(rental.id);
    const url = '/(main)/(hireRide)/Waiting';

    if (kind === 'refund') {
      const amount =
        typeof refundAmount === 'number' && refundAmount > 0
          ? refundAmount
          : Number(rental.refundedAmount || 0);
      const amountLabel = Number.isFinite(amount)
        ? `₦${Math.round(amount).toLocaleString('en-NG')}`
        : 'your payment';

      this.push.sendToUser(userId, {
        title: 'Rental refund update',
        body: `A refund of ${amountLabel} is being processed for your car rental.`,
        app: 'rider',
        data: {
          type: 'RentalRefunded',
          rentalId,
          status: String(rental.status),
          url,
        },
      });
      return;
    }

    const copyByStatus: Partial<
      Record<RentalStatus, { title: string; body: string }>
    > = {
      [RentalStatus.Accepted]: {
        title: 'Rental confirmed',
        body: 'Your car rental request was accepted. We’ll notify you when it starts.',
      },
      [RentalStatus.InProgress]: {
        title: 'Rental started',
        body: 'Your car rental is now active. Open the app to see elapsed time.',
      },
      [RentalStatus.Completed]: {
        title: 'Rental completed',
        body: 'Your car rental has been marked complete. Thanks for riding with Ritz.',
      },
      [RentalStatus.Cancelled]: {
        title: 'Rental cancelled',
        body: 'Your car rental was cancelled. Contact support if you need help.',
      },
      [RentalStatus.Rejected]: {
        title: 'Rental request declined',
        body: 'Your car rental request was declined. A refund will be processed if payment was taken.',
      },
      [RentalStatus.Pending]: {
        title: 'Rental request received',
        body: 'We’re reviewing your car rental request.',
      },
    };

    const copy = copyByStatus[rental.status];
    if (!copy) {
      return;
    }

    this.push.sendToUser(userId, {
      title: copy.title,
      body: copy.body,
      app: 'rider',
      data: {
        type: 'RentalStatusUpdated',
        rentalId,
        status: String(rental.status),
        url,
      },
    });
  }

  private assertRentalTransition(
    current: RentalStatus,
    next: RentalStatus,
  ): void {
    const allowed: Record<RentalStatus, RentalStatus[]> = {
      [RentalStatus.Pending]: [
        RentalStatus.Accepted,
        RentalStatus.Cancelled,
        RentalStatus.Rejected,
      ],
      [RentalStatus.Accepted]: [
        RentalStatus.InProgress,
        RentalStatus.Cancelled,
      ],
      [RentalStatus.InProgress]: [
        RentalStatus.Completed,
        RentalStatus.Cancelled,
      ],
      [RentalStatus.Completed]: [],
      [RentalStatus.Cancelled]: [],
      [RentalStatus.Rejected]: [],
    };

    if (!allowed[current]?.includes(next)) {
      throw new BadRequestException(
        `Cannot transition rental from ${current} to ${next}`,
      );
    }
  }

  private getRefundableAmount(rental: RentalDocument): number {
    const refunded = Number(rental.refundedAmount || 0);
    return Math.max(0, Number(rental.price || 0) - refunded);
  }

  private async applyRentalRefund(
    rental: RentalDocument,
    amount?: number,
    note?: string,
  ) {
    const remaining = this.getRefundableAmount(rental);
    if (remaining <= 0) {
      throw new BadRequestException('Rental has already been fully refunded');
    }

    const refundAmount =
      typeof amount === 'number' ? Math.abs(amount) : remaining;

    if (refundAmount <= 0) {
      throw new BadRequestException('Refund amount must be greater than zero');
    }

    if (refundAmount > remaining + 0.0001) {
      throw new BadRequestException(
        `Refund amount cannot exceed remaining ${remaining}`,
      );
    }

    const userId = this.getRentalUserId(rental);
    const user =
      userId && isMongoId(userId) ? await this.db.users.findById(userId) : null;

    const paymentResponse = (rental.meta as Record<string, unknown> | undefined)
      ?.paymentResponse;

    const refundResult = await this.paymentService.refundCharge({
      user,
      paymentMethod: rental.paymentMethod,
      paymentResponse,
      amount: refundAmount,
      note: note || `Rental ${rental.id} refund`,
    });

    const counted =
      refundResult &&
      typeof refundResult === 'object' &&
      (refundResult as { status?: string }).status !== 'skipped';

    const nextRefunded = counted
      ? Number(rental.refundedAmount || 0) + refundAmount
      : Number(rental.refundedAmount || 0);

    const meta = {
      ...(rental.meta || {}),
      refundResponse: refundResult,
    };

    return this.db.rentals
      .findOneAndUpdate(
        { _id: rental.id },
        {
          $set: {
            ...(counted
              ? {
                  refundedAmount: nextRefunded,
                  refundedAt: new Date(),
                }
              : {}),
            meta,
          },
        },
        { new: true },
      )
      .populate(RIDER_RENTAL_POPULATE);
  }

  async updateRentalStatus(
    rentalId: string,
    status: RentalStatus,
    options: { ownerId?: string } = {},
  ) {
    let rental = await this.getRental(rentalId);

    if (options.ownerId) {
      const driverId = Util.resolveDocumentId(rental.driver);
      const ownerMatch =
        driverId != null && driverId === String(options.ownerId);
      if (!ownerMatch) {
        throw new NotFoundException('Rental not found');
      }
    }

    this.assertRentalTransition(rental.status, status);

    if (status === RentalStatus.Rejected || status === RentalStatus.Cancelled) {
      const remaining = this.getRefundableAmount(rental);
      if (remaining > 0) {
        const refunded = await this.applyRentalRefund(
          rental,
          remaining,
          `Rental ${rental.id} ${status.toLowerCase()}`,
        );
        if (!refunded) {
          throw new NotFoundException('Rental not found');
        }
        rental = refunded;
      }
    }

    if (status === RentalStatus.Completed && !rental.settledAt) {
      rental = (await this.settleCompletedRental(rental)) as typeof rental;
    }

    const $set: Record<string, unknown> = { status };
    if (status === RentalStatus.InProgress) {
      $set.startedAt = new Date();
    }
    if (status === RentalStatus.Completed) {
      $set.endedAt = new Date();
      if (rental.settledAt) {
        $set.settledAt = rental.settledAt;
      }
      if (rental.cautionRefundedAt) {
        $set.cautionRefundedAt = rental.cautionRefundedAt;
      }
      if (rental.refundedAmount != null) {
        $set.refundedAmount = rental.refundedAmount;
      }
      if (rental.refundedAt) {
        $set.refundedAt = rental.refundedAt;
      }
      if (rental.meta) {
        $set.meta = rental.meta;
      }
    }

    const updated = await this.db.rentals
      .findOneAndUpdate({ _id: rental.id }, { $set }, { new: true })
      .populate('user driver ride');

    if (!updated) {
      throw new NotFoundException('Rental not found');
    }

    await this.syncHireRideAvailability(
      updated.ride as RidesDocument | string,
      status,
    );
    await this.emitRentalStatusUpdated(updated);
    this.notifyRentalRider(updated, 'status');
    return updated;
  }

  private async settleCompletedRental(rental: RentalDocument) {
    if (rental.settledAt) {
      return rental;
    }

    let current = rental;
    const cautionAmount = Math.max(0, Number(rental.cautionAmount) || 0);
    const hireFee = Math.max(0, Number(rental.hireFee) || 0);

    // Legacy bookings may only have `price` — treat full price as hire fee, no caution.
    const effectiveHireFee =
      hireFee > 0
        ? hireFee
        : cautionAmount > 0
        ? Math.max(0, Number(rental.price || 0) - cautionAmount)
        : Number(rental.price || 0);
    const effectiveCaution = cautionAmount > 0 ? cautionAmount : 0;

    if (effectiveCaution > 0 && !rental.cautionRefundedAt) {
      const remaining = this.getRefundableAmount(current);
      const refundCaution = Math.min(effectiveCaution, remaining);
      if (refundCaution > 0) {
        const refunded = await this.applyRentalRefund(
          current,
          refundCaution,
          `Rental ${rental.id} caution release`,
        );
        if (refunded) {
          current = refunded;
        }
      }
    }

    const ownerId = this.getRentalDriverId(current);
    if (ownerId && effectiveHireFee > 0) {
      await this.activityLedger.recordDriverEarning({
        driver: ownerId,
        rental: String(current.id),
        amount: effectiveHireFee,
        paymentMethod: current.paymentMethod as PaymentMethod,
      });
    }

    return this.db.rentals
      .findOneAndUpdate(
        { _id: current.id },
        {
          $set: {
            settledAt: new Date(),
            ...(effectiveCaution > 0 ? { cautionRefundedAt: new Date() } : {}),
            refundedAmount: current.refundedAmount,
            refundedAt: current.refundedAt,
            meta: current.meta,
          },
        },
        { new: true },
      )
      .populate('user driver ride')
      .then((doc) => doc || current);
  }

  private getRentalDriverId(rental: RentalDocument): string | null {
    return Util.resolveDocumentId(rental.driver);
  }

  async getOwnerRentals(owner: UserDocument, query: AdminGetRentalsDTO) {
    const { page = 1, limit = 100, status } = query;
    const q: FilterQuery<RentalDocument> = {
      driver: owner.id,
      deleted: { $ne: true },
    };
    if (status) {
      q.status = { $in: Array.isArray(status) ? status : [status] };
    }

    return this.db.rentals.paginate(q, {
      page,
      limit,
      populate: [
        { path: 'user', select: 'firstName lastName email phoneNumber avatar' },
        { path: 'ride' },
      ],
      sort: { createdAt: -1 },
    });
  }

  async getRiderRentals(user: UserDocument, query: AdminGetRentalsDTO) {
    const { page = 1, limit = 100, status } = query;
    const q: FilterQuery<RentalDocument> = {
      user: user.id,
      deleted: { $ne: true },
    };
    if (status) {
      q.status = { $in: Array.isArray(status) ? status : [status] };
    }

    return this.db.rentals.paginate(q, {
      page,
      limit,
      populate: [
        {
          path: 'driver',
          select: 'firstName lastName email phoneNumber avatar',
        },
        { path: 'ride' },
      ],
      sort: { createdAt: -1 },
    });
  }

  async getRiderRental(user: UserDocument, rentalId: string) {
    const rental = await this.db.rentals
      .findOne({
        _id: rentalId,
        user: user.id,
        deleted: { $ne: true },
      })
      .populate(RIDER_RENTAL_POPULATE);

    if (!rental) {
      throw new NotFoundException('Rental not found');
    }

    return rental;
  }

  async cancelRiderRental(
    user: UserDocument,
    rentalId: string,
    reason?: string,
  ) {
    const existing = await this.db.rentals
      .findOne({
        _id: rentalId,
        user: user.id,
        deleted: { $ne: true },
      })
      .populate(RIDER_RENTAL_POPULATE);

    if (!existing) {
      throw new NotFoundException('Rental not found');
    }

    if (existing.status === RentalStatus.Cancelled) {
      return existing;
    }

    if (existing.status !== RentalStatus.Pending) {
      throw new BadRequestException(
        'Only rentals awaiting owner approval can be cancelled',
      );
    }

    const cancellationReason = reason?.trim();
    let cancelled = await this.db.rentals
      .findOneAndUpdate(
        {
          _id: rentalId,
          user: user.id,
          status: RentalStatus.Pending,
          deleted: { $ne: true },
        },
        {
          $set: {
            status: RentalStatus.Cancelled,
            cancelledAt: new Date(),
            cancelledBy: user.id,
            ...(cancellationReason ? { cancellationReason } : {}),
          },
        },
        { new: true },
      )
      .populate(RIDER_RENTAL_POPULATE);

    if (!cancelled) {
      const raced = await this.getRiderRental(user, rentalId);
      if (raced.status === RentalStatus.Cancelled) {
        return raced;
      }
      throw new BadRequestException('Rental can no longer be cancelled');
    }

    const refundableAmount = this.getRefundableAmount(cancelled);
    if (refundableAmount > 0) {
      try {
        const refunded = await this.applyRentalRefund(
          cancelled,
          refundableAmount,
          `Rental ${cancelled.id} cancelled by rider`,
        );
        if (refunded) {
          cancelled = refunded;
        }
      } catch (error) {
        cancelled =
          (await this.db.rentals
            .findOneAndUpdate(
              { _id: cancelled.id },
              {
                $set: {
                  meta: {
                    ...(cancelled.meta || {}),
                    refundResponse: {
                      status: 'failed',
                      reason:
                        error instanceof Error
                          ? error.message
                          : 'Unable to initiate refund',
                    },
                  },
                },
              },
              { new: true },
            )
            .populate(RIDER_RENTAL_POPULATE)) || cancelled;
      }
    }

    await this.syncHireRideAvailability(
      cancelled.ride as RidesDocument | string,
      RentalStatus.Cancelled,
    );
    await this.emitRentalStatusUpdated(cancelled);
    this.notifyRentalRider(cancelled, 'status');

    const refundResponse = (
      cancelled.meta as { refundResponse?: { status?: string } } | undefined
    )?.refundResponse;
    if (refundResponse?.status !== 'failed' && refundableAmount > 0) {
      this.notifyRentalRider(cancelled, 'refund', refundableAmount);
    }

    const ownerId = this.getRentalDriverId(cancelled);
    if (ownerId) {
      this.push.sendToUser(ownerId, {
        title: 'Car rental cancelled',
        body: 'The rider cancelled a rental request that was awaiting your approval.',
        app: 'driver',
        data: {
          type: 'RentalStatusUpdated',
          rentalId: String(cancelled.id),
          status: RentalStatus.Cancelled,
        },
      });
    }

    return cancelled;
  }

  async getOwnerRental(owner: UserDocument, rentalId: string) {
    const rental = await this.db.rentals
      .findOne({
        _id: rentalId,
        driver: owner.id,
        deleted: { $ne: true },
      })
      .populate('user driver ride');

    if (!rental) {
      throw new NotFoundException('Rental not found');
    }

    return rental;
  }

  async updateOwnerRentalStatus(
    owner: UserDocument,
    rentalId: string,
    status: RentalStatus,
  ) {
    return this.updateRentalStatus(rentalId, status, { ownerId: owner.id });
  }

  async getAdminFleet(query: {
    page?: number;
    limit?: number;
    type?: RideType;
    status?: RideStatus;
    approvalStatus?: RideApprovalStatus;
    brand?: string;
  }) {
    const {
      page = 1,
      limit = 100,
      type = RideType.Hire,
      status,
      approvalStatus,
      brand,
    } = query;
    const q: FilterQuery<RidesDocument> = {
      deleted: { $ne: true },
      type,
    };
    if (status) {
      q.status = status;
    }
    if (approvalStatus) {
      q.approvalStatus = approvalStatus;
    }
    if (brand) {
      q.brand = new RegExp(brand, 'i');
    }

    return this.db.rides.paginate(q, {
      page,
      limit,
      populate: [
        {
          path: 'driver',
          select: 'firstName lastName email phoneNumber avatar isVerified',
        },
      ],
      sort: { createdAt: -1 },
    });
  }

  async setAdminFleetApproval(
    admin: UserDocument,
    rideId: string,
    status: RideApprovalStatus.Approved | RideApprovalStatus.Rejected,
    vehicleCategory?: VehicleCategory,
    reason?: string,
  ) {
    const ride = await this.db.rides.findOne({
      _id: rideId,
      deleted: { $ne: true },
    });
    if (!ride) {
      throw new NotFoundException('Ride not found');
    }
    if (ride.type === RideType.Hire) {
      throw new BadRequestException(
        'Hire listings do not use trip-vehicle approval',
      );
    }

    if (status === RideApprovalStatus.Approved && !vehicleCategory) {
      throw new BadRequestException(
        'vehicle category is required before approval',
      );
    }

    const $set: Record<string, unknown> = { approvalStatus: status };
    if (reason !== undefined) {
      $set.approvalReason = reason;
    }
    if (status === RideApprovalStatus.Rejected) {
      $set.status = RideStatus.Offline;
    } else {
      $set.vehicleCategory = vehicleCategory;
      $set.type =
        vehicleCategory === VehicleCategory.Luxury
          ? RideType.Luxury
          : RideType.Classic;
      $set.categoryReviewedBy = admin.id;
      $set.categoryReviewedAt = new Date();
    }

    const updated = await this.db.rides.findOneAndUpdate(
      { _id: ride.id },
      { $set },
      { new: true },
    );

    if (!updated) {
      throw new NotFoundException('Ride not found');
    }

    await this.db.adminAuditLogs.create({
      action: AdminAuditAction.VehicleReviewed,
      actor: admin.id,
      reason:
        reason?.trim() ||
        (status === RideApprovalStatus.Approved
          ? 'Vehicle approved during application review'
          : 'Vehicle rejected during application review'),
      targetUserId:
        typeof ride.driver === 'string'
          ? ride.driver
          : String(ride.driver?.id || ''),
      meta: {
        rideId: String(ride.id),
        claimedCategory: ride.claimedCategory,
        previousCategory: ride.vehicleCategory,
        vehicleCategory: updated.vehicleCategory,
        previousStatus: ride.approvalStatus,
        status: updated.approvalStatus,
      },
    });

    return updated;
  }

  async getAdminFleetRide(rideId: string) {
    const ride = await this.db.rides
      .findOne({ _id: rideId, deleted: { $ne: true } })
      .populate({
        path: 'driver',
        select: 'firstName lastName email phoneNumber avatar isVerified',
      });

    if (!ride) {
      throw new NotFoundException('Ride not found');
    }

    const openRentals = await this.db.rentals
      .find({
        ride: ride.id,
        status: {
          $in: [
            RentalStatus.Pending,
            RentalStatus.Accepted,
            RentalStatus.InProgress,
          ],
        },
        deleted: { $ne: true },
      })
      .populate('user', 'firstName lastName email phoneNumber')
      .sort({ createdAt: -1 })
      .limit(20);

    return { ride, openRentals };
  }

  async refundRental(rentalId: string, amount?: number) {
    const rental = await this.getRental(rentalId);
    const previousRefunded = Number(rental.refundedAmount || 0);
    const updated = await this.applyRentalRefund(
      rental,
      amount,
      `Rental ${rental.id} admin refund`,
    );

    if (!updated) {
      throw new NotFoundException('Rental not found');
    }

    await this.emitRentalStatusUpdated(updated);
    const refundedDelta =
      Number(updated.refundedAmount || 0) - previousRefunded;
    this.notifyRentalRider(
      updated,
      'refund',
      refundedDelta > 0 ? refundedDelta : amount,
    );
    return updated;
  }
}
