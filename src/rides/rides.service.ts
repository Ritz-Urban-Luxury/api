import {
  BadRequestException,
  CACHE_MANAGER,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Cache } from 'cache-manager';
import { DatabaseService } from 'src/database/database.service';
import { RidesDocument, RideStatus } from 'src/database/schemas/rides.schema';
import { TripDocument, TripStatus } from 'src/database/schemas/trips.schema';
import { UserDocument } from 'src/database/schemas/user.schema';
import { WebsocketGateway } from 'src/websocket/websocket.gateway';
import {
  AcceptRideDTO,
  GetRideQuoteDTO,
  GetRidesDTO,
  MessageDTO,
  RequestRideDTO,
  UpdateTripDTO,
} from './dto/rides.dto';
import { GeolocationService } from './geolocation.service';

@Injectable()
export class RidesService {
  private readonly WAIT_TIME = 10 * 1000;

  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly websocket: WebsocketGateway,
    private readonly db: DatabaseService,
  ) {}

  async getAvailableRides(payload: GetRidesDTO) {
    const { lat, lon } = payload;

    return this.db.rides.find({
      status: { $in: [RideStatus.Online, RideStatus.FinishingTrip] },
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [lat, lon] },
          $maxDistance: 5000,
        },
      },
    });
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
    return this.db.trips.findOne({
      user: user.id,
      status: { $nin: [TripStatus.Cancelled, TripStatus.Completed] },
      deleted: { $ne: true },
    });
  }

  async requestRide(user: UserDocument, payload: RequestRideDTO) {
    const { fromLat, fromLon, type } = payload;
    const ongoingTrip = await this.db.trips.findOne({
      user: user.id,
      status: { $nin: [TripStatus.Cancelled, TripStatus.Completed] },
      deleted: { $ne: true },
    });
    if (ongoingTrip) {
      throw new BadRequestException('another trip currently ongoing');
    }

    const trackingId = Math.random().toString(32).substring(2);
    let available = await this.db.rides
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
      .populate('driver');

    available = available.sort((a) =>
      a.status === RideStatus.Online ? -1 : 1,
    );
    if (!available.length) {
      throw new BadRequestException('All drivers are busy at this time');
    }

    await this.cache.set(trackingId, true, this.WAIT_TIME * available.length);
    this.connectToDriver(user, available, trackingId, payload);

    return { ride: available[0], trackingId };
  }

  async cancelConnection(payload: AcceptRideDTO) {
    const { trackingId } = payload;
    const value = await this.cache.get<boolean>(trackingId);
    if (typeof value !== 'boolean') {
      throw new BadRequestException('invalid tracking id');
    }

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
    payload: RequestRideDTO,
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
        return;
      }

      if (accepted) {
        const distance = await GeolocationService.getDistance(
          [payload.fromLat, payload.fromLon],
          [payload.toLat, payload.toLon],
        );
        const quotes = await this.getRideQuotes({ distance });
        const amount = quotes[payload.type.toLowerCase()];
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
            distance,
            amount,
          }),
          this.cache.del(connectionId),
        ]);

        this.websocket.emitToUser(user, 'TripStarted', trip);
        this.websocket.emitToUser(driver, 'TripStarted', trip);

        return;
      }
    }

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
      { $set: { status: TripStatus.Cancelled, cancellationReason: reason } },
      {
        populate: { path: 'user driver' },
        options: { upsert: false, new: true },
        error: new NotFoundException('trip not found'),
      },
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
        default:
        // do nothing
      }
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
}
