import { UseFilters, UseGuards, UsePipes } from '@nestjs/common';
import {
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuthenticationService } from '../authentication';
import { WSJwtGuard } from '../authentication/guards/ws-jwt.guard';
import { DatabaseService } from '../database/database.service';
import { RideStatus, RidesDocument } from '../database/schemas/rides.schema';
import {
  InactiveTripStatuses,
  TripDocument,
  TripStatus,
} from '../database/schemas/trips.schema';
import { UserDocument } from '../database/schemas/user.schema';
import { Logger } from '../logger/logger.service';
import { GeolocationService } from '../rides/geolocation.service';
import { CurrentClientUser } from '../shared/decorators/current-client-user.decorator';
import { WSValidationFilter } from '../shared/filter/ws-validation-filter';
import { ValidationPipe } from '../shared/pipes/validation.pipe';
import { Util } from '../shared/util';
import { DriverETADTO, RideLocationDTO } from './dto/websocket.dto';
import {
  RideLocationEventPayload,
  WebsocketEvent,
  WebsocketEventType,
} from './types';

@WebSocketGateway({ transports: ['websocket'] })
@UseFilters(WSValidationFilter)
@UsePipes(ValidationPipe)
export class WebsocketGateway {
  private readonly lastLocationSequence = new Map<string, number>();

  private readonly lastLocationPersistence = new Map<string, number>();

  @WebSocketServer()
  private readonly server: Server;

  constructor(
    private readonly authenticationService: AuthenticationService,
    private readonly logger: Logger,
    private readonly db: DatabaseService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const user = await this.authenticationService.validateWebsocketClient(
        client,
      );

      client.join(user.id);
    } catch (error) {
      if (!['Unauthorized'].includes(error.message)) {
        this.logger.error(
          `error handling client connection - ${error.message}`,
        );
      }
      client.disconnect();
    }
  }

  async emitToUser<T>(user: UserDocument, event: WebsocketEventType, data: T) {
    this.server.to(user.id).emit(event, data);
  }

  /** How many sockets are currently in this user's room. */
  getUserRoomSize(userId: string): number {
    return this.server.sockets.adapter.rooms.get(userId)?.size ?? 0;
  }

  async updateRideStatus(
    trip: TripDocument,
    ride: string,
    coords: [number, number],
  ) {
    if (trip?.status === TripStatus.InProgress) {
      const distance = Util.calculateDistance(
        coords,
        trip.nextDestination.to.coordinates,
      );

      if (distance <= 1000) {
        await this.db.rides.updateOne(
          { _id: ride },
          { $set: { status: RideStatus.FinishingTrip } },
        );
      }
    }
  }

  // Subscriptions
  @UseGuards(WSJwtGuard)
  @SubscribeMessage(WebsocketEvent.RideLocation)
  async updateRideLocation(
    @CurrentClientUser() user: UserDocument,
    @MessageBody() payload: RideLocationDTO,
  ) {
    const trip = await this.db.trips
      .findOne({
        driver: user.id,
        status: { $nin: InactiveTripStatuses },
        deleted: { $ne: true },
      })
      .populate('user');

    if (!trip) {
      await this.persistRideLocation(user.id, payload);
      return;
    }

    const lastSequence = this.lastLocationSequence.get(user.id);
    if (
      payload.sequence !== undefined &&
      lastSequence !== undefined &&
      payload.sequence <= lastSequence
    ) {
      return;
    }

    if (payload.sequence !== undefined) {
      this.lastLocationSequence.set(user.id, payload.sequence);
    }

    const rideId = typeof trip.ride === 'string' ? trip.ride : trip.ride?.id;
    if (!rideId) {
      return;
    }

    const recordedAt = payload.recordedAt ?? new Date().toISOString();
    const locationEvent: RideLocationEventPayload = {
      accuracy: payload.accuracy,
      tripId: trip.id,
      rideId,
      lat: payload.lat,
      lon: payload.lon,
      heading: payload.heading,
      recordedAt,
      sequence: payload.sequence,
      speed: payload.speed,
      updatedAt: new Date().toISOString(),
    };

    await this.emitToUser(
      trip.user as UserDocument,
      WebsocketEvent.RideLocation,
      locationEvent,
    );

    if (this.shouldPersistLocation(rideId)) {
      await Promise.all([
        this.persistRideLocation(user.id, payload),
        this.updateRideStatus(trip, rideId, [payload.lat, payload.lon]),
      ]);
    }
  }

  private shouldPersistLocation(rideId: string) {
    const now = Date.now();
    const lastPersistedAt = this.lastLocationPersistence.get(rideId) ?? 0;

    if (now - lastPersistedAt < 10000) {
      return false;
    }

    this.lastLocationPersistence.set(rideId, now);
    return true;
  }

  private async persistRideLocation(
    driverId: string,
    payload: RideLocationDTO,
  ) {
    return this.db.rides.findOneAndUpdate(
      { driver: driverId },
      {
        $set: {
          location: {
            accuracy: payload.accuracy,
            coordinates: [payload.lat, payload.lon],
            heading: payload.heading,
            recordedAt: payload.recordedAt
              ? new Date(payload.recordedAt)
              : new Date(),
            sequence: payload.sequence,
            speed: payload.speed,
            type: 'Point',
          },
        },
      },
      { new: true },
    );
  }

  @UseGuards(WSJwtGuard)
  @SubscribeMessage(WebsocketEvent.RideETA)
  async getDriverETA(
    @CurrentClientUser() user: UserDocument,
    @MessageBody() payload: DriverETADTO,
  ) {
    const trip = await this.db.trips
      .findOne({
        user: user.id,
        status: { $nin: InactiveTripStatuses },
        deleted: { $ne: true },
      })
      .populate('ride');

    if (trip) {
      const ride = trip.ride as RidesDocument;
      const coordinates =
        trip.status === TripStatus.Started
          ? trip.from.coordinates
          : trip.nextDestination?.to?.coordinates;
      const eta = payload.ignoreETA
        ? null
        : await GeolocationService.getETA(
            ride.location.coordinates,
            coordinates,
          );

      this.emitToUser(user, WebsocketEvent.RideETA, {
        eta,
        location: ride.location,
      });
    }
  }
}
