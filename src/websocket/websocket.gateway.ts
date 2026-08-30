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

  /** Freshest driver ping per trip — used by rider HTTP polling fallback. */
  private readonly lastRideLocations = new Map<
    string,
    RideLocationEventPayload
  >();

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

  async emitToUser<T>(
    user: UserDocument | string,
    event: WebsocketEventType,
    data: T,
  ) {
    const roomId =
      typeof user === 'string'
        ? user
        : (user?.id ?? String((user as { _id?: unknown })?._id ?? ''));

    if (!roomId) {
      this.logger.warn(`emitToUser skipped — missing user room for ${event}`);
      return;
    }

    this.server.to(roomId).emit(event, data);
  }

  /** How many sockets are currently in this user's room. */
  getUserRoomSize(userId: string): number {
    return this.server.sockets.adapter.rooms.get(userId)?.size ?? 0;
  }

  getLastRideLocation(tripId: string): RideLocationEventPayload | null {
    return this.lastRideLocations.get(tripId) ?? null;
  }

  clearLastRideLocation(tripId: string) {
    this.lastRideLocations.delete(tripId);
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
    const location = this.normalizeRideLocation(payload);
    if (!location) {
      return;
    }

    const trip = await this.db.trips
      .findOne({
        driver: user.id,
        status: { $nin: InactiveTripStatuses },
        deleted: { $ne: true },
      })
      .populate('user');

    if (!trip) {
      await this.persistRideLocation(user.id, location);
      return;
    }

    const lastSequence = this.lastLocationSequence.get(user.id);
    if (
      location.sequence !== undefined &&
      lastSequence !== undefined &&
      location.sequence <= lastSequence
    ) {
      return;
    }

    if (location.sequence !== undefined) {
      this.lastLocationSequence.set(user.id, location.sequence);
    }

    const rideId = typeof trip.ride === 'string' ? trip.ride : trip.ride?.id;
    if (!rideId) {
      return;
    }

    const recordedAt = location.recordedAt ?? new Date().toISOString();
    const locationEvent: RideLocationEventPayload = {
      accuracy: location.accuracy,
      tripId: trip.id,
      rideId,
      lat: location.lat,
      lon: location.lon,
      heading: location.heading,
      recordedAt,
      sequence: location.sequence,
      speed: location.speed,
      updatedAt: new Date().toISOString(),
    };

    this.lastRideLocations.set(trip.id, locationEvent);

    const riderRoomId =
      typeof trip.user === 'string'
        ? trip.user
        : ((trip.user as UserDocument)?.id ??
          String((trip.user as { _id?: unknown })?._id ?? ''));

    await this.emitToUser(
      riderRoomId,
      WebsocketEvent.RideLocation,
      locationEvent,
    );

    // Always keep the ride document fresh enough for HTTP polling.
    await this.persistRideLocation(user.id, location);

    if (this.shouldPersistLocation(rideId)) {
      await this.updateRideStatus(trip, rideId, [location.lat, location.lon]);
    }
  }

  private shouldPersistLocation(rideId: string) {
    const now = Date.now();
    const lastPersistedAt = this.lastLocationPersistence.get(rideId) ?? 0;

    // Keep DB fresh enough for rider HTTP polling fallback (~2–3s).
    if (now - lastPersistedAt < 2000) {
      return false;
    }

    this.lastLocationPersistence.set(rideId, now);
    return true;
  }

  private normalizeRideLocation(payload: RideLocationDTO): {
    accuracy?: number;
    lat: number;
    lon: number;
    heading?: number;
    recordedAt?: string;
    sequence?: number;
    speed?: number;
  } | null {
    const lat = Number(payload.lat);
    const lon = Number(payload.lon);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      this.logger.warn(
        `ignoring RideLocation with non-numeric coords lat=${payload.lat} lon=${payload.lon}`,
      );
      return null;
    }

    const accuracy =
      payload.accuracy === undefined || payload.accuracy === null
        ? undefined
        : Number(payload.accuracy);
    const heading =
      payload.heading === undefined || payload.heading === null
        ? undefined
        : Number(payload.heading);
    const sequence =
      payload.sequence === undefined || payload.sequence === null
        ? undefined
        : Number(payload.sequence);
    const speed =
      payload.speed === undefined || payload.speed === null
        ? undefined
        : Number(payload.speed);

    return {
      accuracy: Number.isFinite(accuracy) ? accuracy : undefined,
      lat,
      lon,
      heading: Number.isFinite(heading) ? heading : undefined,
      recordedAt: payload.recordedAt,
      sequence: Number.isFinite(sequence) ? sequence : undefined,
      speed: Number.isFinite(speed) ? speed : undefined,
    };
  }

  private async persistRideLocation(
    driverId: string,
    payload: {
      accuracy?: number;
      lat: number;
      lon: number;
      heading?: number;
      recordedAt?: string;
      sequence?: number;
      speed?: number;
    },
  ) {
    try {
      // Keep GeoJSON `type` + `coordinates` first. MongoDB 2dsphere rejects
      // Points when non-geo fields are serialized ahead of `type`.
      return await this.db.rides.findOneAndUpdate(
        { driver: driverId },
        {
          $set: {
            location: {
              type: 'Point',
              coordinates: [payload.lat, payload.lon],
              accuracy: payload.accuracy,
              heading: payload.heading,
              recordedAt: payload.recordedAt
                ? new Date(payload.recordedAt)
                : new Date(),
              sequence: payload.sequence,
              speed: payload.speed,
            },
          },
        },
        { new: true },
      );
    } catch (error) {
      this.logger.warn(
        `failed to persist ride location for driver ${driverId}: ${
          (error as Error)?.message || error
        }`,
      );
      return null;
    }
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
      const liveLocation = this.lastRideLocations.get(trip.id);
      const fromCoordinates: [number, number] = liveLocation
        ? [liveLocation.lat, liveLocation.lon]
        : (ride.location.coordinates as [number, number]);
      const coordinates =
        trip.status === TripStatus.Started
          ? trip.from.coordinates
          : trip.nextDestination?.to?.coordinates;
      const eta = payload.ignoreETA
        ? null
        : await GeolocationService.getETA(fromCoordinates, coordinates);

      this.emitToUser(user, WebsocketEvent.RideETA, {
        eta,
        location: liveLocation
          ? {
              type: 'Point',
              coordinates: fromCoordinates,
              heading: liveLocation.heading,
              recordedAt: liveLocation.recordedAt,
              sequence: liveLocation.sequence,
              speed: liveLocation.speed,
              accuracy: liveLocation.accuracy,
            }
          : ride.location,
      });
    }
  }
}
