import {
  BadRequestException,
  CACHE_MANAGER,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Cache } from 'cache-manager';
import { FilterQuery } from 'mongoose';
import {
  RentalBillingType,
  RentalDocument,
  RentalStatus,
} from 'src/database/schemas/rentals.schema';
import { ActivityLedgerService } from '../database/activity-ledger.service';
import { DatabaseService } from '../database/database.service';
import { ActivityType } from '../database/schemas/activities.schema';
import {
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
import { WebsocketGateway } from '../websocket/websocket.gateway';
import {
  AcceptRideDTO,
  AdminGetRentalsDTO,
  AdminGetTripsDTO,
  CreateRideDTO,
  GetRideQuoteDTO,
  GetRidesDTO,
  HireRideDTO,
  MessageDTO,
  RequestRideDTO,
  RideStopsDTO,
  UpdateRideDTO,
  UpdateTripDTO,
} from './dto/rides.dto';
import { GeolocationService } from './geolocation.service';

@Injectable()
export class RidesService {
  private readonly WAIT_TIME = 20 * 1000;

  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly websocket: WebsocketGateway,
    private readonly db: DatabaseService,
    private readonly paymentService: PaymentService,
    private readonly activityLedger: ActivityLedgerService,
    private readonly push: PushNotificationService,
  ) {}

  async getAvailableRides(payload: GetRidesDTO) {
    const { lat, lon, type } = payload;
    const query: FilterQuery<RidesDocument> = {
      status: { $in: [RideStatus.Online, RideStatus.FinishingTrip] },
      type: { $ne: RideType.Hire },
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [lat, lon] },
          $maxDistance: payload.radius || 5000,
        },
      },
    };
    if (type) {
      query.type = { $in: Array.isArray(type) ? type : [type] };
    }

    return this.db.rides
      .find(query)
      .populate({ path: 'driver', select: 'avatar' });
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

    const trip = await this.db.trips
      .findOne({
        $or: [{ user: user.id }, { driver: user.id }],
        status: { $nin: InactiveTripStatuses },
        deleted: { $ne: true },
      })
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

    const trackingId = Math.random().toString(32).substring(2);
    const [_available, distance] = await Promise.all([
      this.db.rides
        .find({
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

    const available = _available.sort((a) =>
      a.status === RideStatus.Online ? -1 : 1,
    );
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

  async cancelConnection(user: UserDocument, payload: AcceptRideDTO) {
    const { trackingId } = payload;
    const value = await this.cache.get<string>(`${user.id}`);
    if (value !== trackingId) {
      throw new BadRequestException('invalid tracking id');
    }

    await this.cache.del(`${user.id}`);
    await this.cache.set(payload.trackingId, false, this.WAIT_TIME);
  }

  async acceptRide(payload: AcceptRideDTO) {
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

      trackingId = Math.random().toString(32).substring(2);

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
          this.cache.del(connectionId),
          this.cache.del(`${user.id}`),
        ]);

        this.websocket.emitToUser(user, 'TripStarted', trip);
        this.websocket.emitToUser(driver, 'TripStarted', trip);
        this.push.sendToUser(user, {
          title: 'Driver on the way',
          body: 'Your driver accepted the ride',
          app: 'rider',
          data: {
            type: 'TripStarted',
            tripId: String(trip.id),
          },
        });

        return;
      }
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
    const trip = await this.db.findAndUpdateOrFail<TripDocument>(
      this.db.trips,
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
      {
        populate: { path: 'user driver' },
        options: { upsert: false, new: true },
        error: new NotFoundException('trip not found'),
      },
    );

    await this.db.rides.updateOne(
      { _id: trip.ride },
      { $set: { status: RideStatus.Online } },
    );

    this.websocket.emitToUser(trip.user as UserDocument, 'TripCancelled', trip);
    this.websocket.emitToUser(
      trip.driver as UserDocument,
      'TripCancelled',
      trip,
    );

    const rider = trip.user as UserDocument;
    const driver = trip.driver as UserDocument;
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

    return this.db.messages.find({
      trip: trip.id,
    });
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
      { $set: { status: TripStatus.DriverArrived } },
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
      { $set: { status: TripStatus.InProgress } },
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
      });
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

  async getTripHistory(user: UserDocument, payload: PaginationRequestDTO) {
    const { page = 1, limit = 100 } = payload;

    return this.db.trips.paginate(
      {
        user: user.id,
        deleted: { $ne: true },
      },
      {
        page,
        limit,
        sort: { createdAt: -1 },
        populate: [
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
        user: user.id,
        deleted: { $ne: true },
      })
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
    payload: Pick<HireRideDTO, 'checkInAt' | 'checkOutAt'>,
  ) {
    const { checkInAt, checkOutAt } = payload;

    return this.db.rentals.findOne({
      user: user.id,
      status: {
        $in: [
          RentalStatus.Pending,
          RentalStatus.Accepted,
          RentalStatus.InProgress,
        ],
      },
      $or: [
        { checkInAt: { $lte: checkInAt }, checkOutAt: { $gte: checkInAt } },
        { checkInAt: { $lte: checkOutAt }, checkOutAt: { $gte: checkOutAt } },
        { billingType: RentalBillingType.Daily },
      ],
    });
  }

  async hireARide(user: UserDocument, payload: HireRideDTO) {
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

    const isDailyBilling = billingType === RentalBillingType.Daily;

    if (isDailyBilling && (!checkInAt || !checkOutAt)) {
      throw new BadRequestException(
        'Provide check in and out dates for daily rentals',
      );
    }

    const query: FilterQuery<RentalDocument> = {
      ride: ride.id,
      status: { $nin: [RentalStatus.Cancelled, RentalStatus.Completed] },
    };
    if (checkInAt && checkOutAt) {
      query.$or = [
        { checkInAt: { $lte: checkInAt }, checkOutAt: { $gte: checkInAt } },
        { checkInAt: { $lte: checkOutAt }, checkOutAt: { $gte: checkOutAt } },
      ];
    }

    const rideRented = await this.db.rentals.exists(query);
    if (rideRented) {
      throw new BadRequestException(
        'Ride is unavailable for selected check in and out period',
      );
    }

    const price = isDailyBilling ? ride.dailyRate : ride.hourlyRate;

    const paymentResponse = await this.paymentService.chargeUser(user, {
      amount: price,
      method: payload.paymentMethod,
    });

    return this.db.rentals.create({
      ...payload,
      ride,
      user: user.id,
      driver: ride.driver,
      price,
      meta: { paymentResponse },
    });
  }

  async createRide(user: UserDocument, payload: CreateRideDTO) {
    const requestedSeats = Number(payload.specs?.seats);
    const seats =
      Number.isFinite(requestedSeats) && requestedSeats > 0
        ? Math.min(12, Math.round(requestedSeats))
        : 4;

    return this.db.rides.findOneAndUpdate(
      { driver: user.id },
      {
        ...payload,
        driver: user.id,
        type: payload.type || RideType.Classic,
        status: RideStatus.Offline,
        specs: {
          ...(payload.specs || {}),
          seats,
        },
      },
      { new: true, upsert: true },
    );
  }

  async updateRide(user: UserDocument, rideId: string, payload: UpdateRideDTO) {
    const ride = await this.db.rides.findOne({
      _id: rideId,
      deleted: { $ne: true },
      driver: user.id,
    });
    if (!ride) {
      throw new BadRequestException('Ride not found');
    }

    return this.db.rides.findOneAndUpdate(
      { _id: ride.id },
      { $set: payload },
      { new: true },
    );
  }

  async setRideAvailability(
    user: UserDocument,
    status: RideStatus.Online | RideStatus.Offline,
  ) {
    const ride = await this.db.rides.findOne({
      deleted: { $ne: true },
      driver: user.id,
    });
    if (!ride) {
      throw new BadRequestException('Ride not found');
    }

    // Busy / FinishingTrip must not be overwritten by availability flips
    if (
      ride.status === RideStatus.Busy ||
      ride.status === RideStatus.FinishingTrip
    ) {
      throw new BadRequestException(
        'cannot change availability while on an active trip',
      );
    }

    if (ride.status === status) {
      return ride;
    }

    return this.db.rides.findOneAndUpdate(
      { _id: ride.id },
      { $set: { status } },
      { new: true },
    );
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

    return this.db.rentals.paginate(q, { page, limit });
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
}
