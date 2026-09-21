import {
  BadRequestException,
  CACHE_MANAGER,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Cache } from 'cache-manager';
import { isMongoId } from 'class-validator';
import { FilterQuery, Types } from 'mongoose';
import { getPlayReviewAccount } from '../authentication/play-review-accounts';
import {
  RentalBillingType,
  RentalDocument,
  RentalStatus,
} from 'src/database/schemas/rentals.schema';
import { ActivityLedgerService } from '../database/activity-ledger.service';
import { DatabaseService } from '../database/database.service';
import { ActivityType } from '../database/schemas/activities.schema';
import { RideOfferOutcome } from '../database/schemas/driver-ride-offer.schema';
import {
  RideApprovalStatus,
  RidesDocument,
  RideStatus,
  RideType,
} from '../database/schemas/rides.schema';
import {
  InactiveTripStatuses,
  PaymentMethod,
  Rating,
  TripDocument,
  TripStatus,
  TripStopStatus,
} from '../database/schemas/trips.schema';
import { UserDocument } from '../database/schemas/user.schema';
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
  ) {}

  private rejectPlayReviewerRealWorldAction(user: UserDocument) {
    if (getPlayReviewAccount(user.email)) {
      throw new BadRequestException(
        'Live bookings and driver availability are disabled for Play reviewer accounts',
      );
    }
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

  async getAvailableRides(payload: GetRidesDTO) {
    const { lat, lon, type } = payload;
    const types = type ? (Array.isArray(type) ? type : [type]) : null;
    const isHireOnly = types?.length === 1 && types[0] === RideType.Hire;

    const query: FilterQuery<RidesDocument> = {
      deleted: { $ne: true },
      'specs.synthetic': { $ne: true },
      status: { $in: [RideStatus.Online, RideStatus.FinishingTrip] },
    };

    if (types) {
      query.type = { $in: types };
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

  async getRideQuotes(payload: GetRideQuoteDTO) {
    const classicPricePerKM = 85;
    const luxuryPricePerKM = 100;
    const { distance } = payload;

    const distanceInKM = distance / 1000;

    return {
      classic: Math.max(700, Math.round(classicPricePerKM * distanceInKM)),
      luxury: Math.max(800, Math.round(luxuryPricePerKM * distanceInKM)),
    };
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
    const [_available, distance] = await Promise.all([
      this.db.rides
        .find({
          'specs.synthetic': { $ne: true },
          status: { $in: [RideStatus.Online, RideStatus.FinishingTrip] },
          type,
          location: {
            $near: {
              $geometry: { type: 'Point', coordinates: [fromLat, fromLon] },
              $maxDistance: 5000,
            },
          },
        })
        .populate('driver'),
      GeolocationService.getDistance(
        [payload.fromLat, payload.fromLon],
        [payload.toLat, payload.toLon],
      ),
    ]);
    const quotes = await this.getRideQuotes({ distance });
    const amount: number = quotes[type.toLowerCase()];
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
    if (!(await this.finance.canDriverReceiveRides(driver.id))) {
      throw new BadRequestException(
        'Pay the required cash-trip commission deposit before accepting rides',
      );
    }
    const { trackingId } = payload;
    const value = await this.cache.get<boolean>(trackingId);
    if (typeof value !== 'boolean') {
      throw new BadRequestException('invalid tracking id');
    }

    await this.cache.set(payload.trackingId, true, this.WAIT_TIME * 2);
  }

  async connectToDriver(
    user: UserDocument,
    available: RidesDocument[],
    connectionId: string,
    payload: RequestRideDTO & { distance: number; amount: number },
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

      if (!(await this.finance.canDriverReceiveRides(driver.id))) {
        await this.db.rides.updateOne(
          { _id: ride.id },
          { $set: { status: RideStatus.Offline } },
        );
        continue;
      }

      trackingId = Math.random().toString(32).substring(2);

      await this.recordRideOffer({
        driverId: driver.id,
        userId: user.id,
        trackingId,
      });

      this.websocket.emitToUser(user, 'ConnectingToDriver', ride);
      this.websocket.emitToUser(driver, 'RideRequest', {
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

      await this.cache.set(trackingId, false, offerTtl);
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
            ride,
            driver,
            stops: (payload.stops || []).map((stop) => ({
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
      .populate('user driver');

    if (!existing) {
      throw new NotFoundException('trip not found');
    }

    if (existing.status === TripStatus.Cancelled) {
      return existing;
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
    let trip = await this.db.findOrFail<TripDocument>(
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
    const user = trip.user as UserDocument;
    const ride = trip.ride as RidesDocument;
    let status = TripStatus.Completed;
    let paymentResponse: unknown;
    let paymentError: string;
    let { distance } = trip;

    trip.tripStops.forEach((stop) => {
      distance += stop?.distance || 0;
    });

    const quotes = await this.getRideQuotes({ distance });
    const amount = quotes[ride.type.toLocaleLowerCase()] || 0;

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

    [trip] = await Promise.all([
      this.db.trips.findOneAndUpdate(
        { _id: trip.id },
        {
          $set: {
            status,
            endedAt: new Date(),
            meta: { paymentResponse, paymentError, amount, distance },
          },
        },
        { new: true, upsert: false },
      ),
      this.db.rides.updateOne(
        { _id: trip.ride },
        { $set: { status: RideStatus.Online } },
      ),
    ]);

    await this.openOnlineSession(driver.id, String(trip.ride));

    const paymentSucceeded = status === TripStatus.Completed;
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

    if (paymentSucceeded) {
      await this.activityLedger.recordDriverEarning({
        driver: driver.id,
        trip: trip.id,
        amount,
        paymentMethod: trip.paymentMethod,
      });
      if (trip.paymentMethod === PaymentMethod.Cash) {
        const financialState =
          await this.finance.ensureDriverRestrictionState(driver.id);
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

    this.websocket.emitToUser(user, event, trip);
    this.websocket.emitToUser(driver, event, trip);

    if (paymentSucceeded) {
      this.push.sendToUser(user, {
        title: 'Trip completed',
        body: 'Thanks for riding with Ritz',
        app: 'rider',
        data: {
          type: 'TripEnded',
          tripId: String(trip.id),
        },
      });
      this.push.sendToUser(driver, {
        title: 'Trip completed',
        body: 'Trip finished successfully',
        app: 'driver',
        data: {
          type: 'TripEnded',
          tripId: String(trip.id),
        },
      });
    } else {
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

    const [data, totalBrands] = await Promise.all([
      this.db.rides.aggregate([
        ...all,
        { $sort: { createdAt: -1 } },
        { $skip },
        { $limit: limit },
      ]),
      this.db.rides.aggregate([...all]),
    ]);

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

    const ownerId = Util.resolveDocumentId(ride.driver);
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
      'specs.synthetic': { $ne: true },
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
      driver: user.id,
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
    const doc: Record<string, unknown> = {
      ...payload,
      driver: user.id,
      type,
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
    const $set = this.buildRidePayload(user, payload, { type: ride.type });
    // Never overwrite ownership or soft-delete via update
    delete $set.driver;

    return this.db.rides.findOneAndUpdate(
      { _id: ride.id },
      { $set },
      { new: true },
    );
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
    if (!rideId) {
      throw new BadRequestException('rideId is required');
    }

    const ride = await this.db.rides.findOne({
      _id: rideId,
      deleted: { $ne: true },
      driver: user.id,
    });
    if (!ride) {
      throw new BadRequestException('Ride not found');
    }

    if (
      status === RideStatus.Online &&
      ride.type !== RideType.Hire &&
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
    userId: string;
    trackingId: string;
  }) {
    try {
      await this.db.driverRideOffers.updateOne(
        { trackingId: payload.trackingId },
        {
          $setOnInsert: {
            driver: payload.driverId,
            user: payload.userId,
            trackingId: payload.trackingId,
            offeredAt: new Date(),
            outcome: RideOfferOutcome.Pending,
          },
        },
        { upsert: true },
      );
    } catch {
      // best-effort stats persistence
    }
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
    return this.db.carBrands.find();
  }

  async getTrips(query: AdminGetTripsDTO) {
    const { page = 1, limit = 100, status } = query;
    const q: FilterQuery<TripDocument> = { deleted: { $ne: true } };
    if (status) {
      q.status = { $in: Array.isArray(status) ? status : [status] };
    }

    return this.db.trips.paginate(q, { page, limit });
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
    rideId: string,
    status: RideApprovalStatus.Approved | RideApprovalStatus.Rejected,
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

    const $set: Record<string, unknown> = { approvalStatus: status };
    if (reason !== undefined) {
      $set.approvalReason = reason;
    }
    if (status === RideApprovalStatus.Rejected) {
      $set.status = RideStatus.Offline;
    }

    const updated = await this.db.rides.findOneAndUpdate(
      { _id: ride.id },
      { $set },
      { new: true },
    );

    if (!updated) {
      throw new NotFoundException('Ride not found');
    }

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
