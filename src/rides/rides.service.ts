import {
  BadRequestException,
  CACHE_MANAGER,
  Inject,
  Injectable,
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
} from './dto/rides.dto';

@Injectable()
export class RidesService {
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

  async requestRide(user: UserDocument, payload: RequestRideDTO) {
    const { lat, lon, type } = payload;
    const trackingId = Math.random().toString(32).substring(2);
    let available = await this.db.rides
      .find({
        status: { $in: [RideStatus.Online, RideStatus.FinishingTrip] },
        type,
        location: {
          $near: {
            $geometry: { type: 'Point', coordinates: [lat, lon] },
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

    await this.cache.set(trackingId, true, 10 * 1000 * available.length);
    this.connectToDriver(user, available, trackingId);

    return { ride: available[0], trackingId };
  }

  async cancelConnection(payload: AcceptRideDTO) {
    const { trackingId } = payload;
    const value = await this.cache.get<boolean>(trackingId);
    if (typeof value !== 'boolean') {
      throw new BadRequestException('invalid tracking id');
    }

    await this.cache.set(payload.trackingId, false, 10 * 1000);
  }

  async acceptRide(payload: AcceptRideDTO) {
    const { trackingId } = payload;
    const value = await this.cache.get<boolean>(trackingId);
    if (typeof value !== 'boolean') {
      throw new BadRequestException('invalid tracking id');
    }

    await this.cache.set(payload.trackingId, true, 10 * 1000);
  }

  async connectToDriver(
    user: UserDocument,
    available: RidesDocument[],
    connectionId: string,
  ) {
    const WAIT_TIME = 10 * 1000;
    let trackingId: string;
    for (let i = 0; i < available.length; i += 1) {
      const waiting = await this.cache.get<boolean>(connectionId);
      if (!waiting) {
        return;
      }
      const ride = available[i];
      const driver = ride.driver as UserDocument;

      trackingId = Math.random().toString(32).substring(2);

      this.websocket.emitToUser(user, 'ConnectingToDriver', ride);
      this.websocket.emitToUser(driver, 'RideRequest', { trackingId });

      await this.cache.set(trackingId, false, WAIT_TIME);
      await new Promise((resolve) => {
        setTimeout(resolve, WAIT_TIME);
      });

      const accepted = await this.cache.get<boolean>(trackingId);
      if (accepted) {
        const trip = await this.db.trips.create({
          user,
          ride,
          driver,
          amount: 0,
        });

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

  async cancelTrip(user: UserDocument, trip: TripDocument, reason: string) {
    const _trip = await this.db.trips
      .findOneAndUpdate(
        { _id: trip.id },
        { $set: { status: TripStatus.Cancelled, cancellationReason: reason } },
        { upsert: true, new: true },
      )
      .populate({ path: 'user driver' });

    this.websocket.emitToUser(
      trip.user as UserDocument,
      'TripCancelled',
      _trip,
    );
    this.websocket.emitToUser(
      trip.driver as UserDocument,
      'TripCancelled',
      _trip,
    );

    return _trip;
  }

  async sendMessage(
    _user: UserDocument,
    trip: TripDocument,
    payload: MessageDTO,
  ) {
    const message = await this.db.messages.create({
      sender: _user.id,
      trip,
      text: payload.text,
    });

    const { driver, user } = await trip.populate('driver user');

    this.websocket.emitToUser(driver as UserDocument, 'NewMessage', message);
    this.websocket.emitToUser(user as UserDocument, 'NewMessage', message);

    return message;
  }

  async getMessages(trip: TripDocument) {
    return this.db.messages.find({
      trip: trip.id,
    });
  }
}
