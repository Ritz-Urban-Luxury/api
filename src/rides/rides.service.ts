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
import { DatabaseService } from '../database/database.service';
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
import { PaymentService } from '../payments/payment.service';
import { PaginationRequestDTO } from '../shared/pagination.dto';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import {
  AcceptRideDTO,
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

    return this.db.trips.findOne({
      user: user.id,
      status: { $nin: InactiveTripStatuses },
      deleted: { $ne: true },
    });
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

    await this.cache.set(
      trackingId,
      true,
      this.WAIT_TIME * available.length * 2,
    );
    await this.cache.set(
      `${user.id}`,
      trackingId,
      this.WAIT_TIME * available.length * 2,
    );
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
    console.log({ value, trackingId });
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

    await this.cache.set(payload.trackingId, true, this.WAIT_TIME);
  }

  async connectToDriver(
    user: UserDocument,
    available: RidesDocument[],
    connectionId: string,
    payload: RequestRideDTO & { distance: number; amount: number },
  ) {
    let trackingId: string;
    for (let i = 0; i < available.length; i += 1) {
      const ride = available[i];
      const driver = ride.driver as UserDocument;

      trackingId = Math.random().toString(32).substring(2);

      this.websocket.emitToUser(user, 'ConnectingToDriver', ride);
      this.websocket.emitToUser(driver, 'RideRequest', { trackingId });

      await this.cache.set(trackingId, false, this.WAIT_TIME);
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

        await Promise.all([
          this.cache.del(connectionId),
          this.cache.del(`${user.id}`),
        ]);
        return;
      }

      if (accepted) {
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

    const event =
      status === TripStatus.Completed ? 'TripEnded' : 'PaymentFailed';

    this.websocket.emitToUser(user, event, trip);
    this.websocket.emitToUser(driver, event, trip);

    return trip;
  }

  async getTripHistory(user: UserDocument, payload: PaginationRequestDTO) {
    const { page = 1, limit = 100 } = payload;

    return this.db.trips.paginate(
      {
        user: user.id,
        deleted: { $ne: true },
      },
      { page, limit },
    );
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

  async getCarBrands(payload: PaginationRequestDTO) {
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
    return this.db.rides.findOneAndUpdate(
      { driver: user.id },
      { ...payload, driver: user.id },
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

  async toggleRideStatus(user: UserDocument) {
    const ride = await this.db.rides.findOne({
      deleted: { $ne: true },
      driver: user.id,
    });
    if (!ride) {
      throw new BadRequestException('Ride not found');
    }

    return this.db.rides.findOneAndUpdate(
      { _id: ride.id },
      {
        $set: {
          status:
            ride.status === RideStatus.Offline
              ? RideStatus.Online
              : RideStatus.Offline,
        },
      },
      { new: true },
    );
  }
}
