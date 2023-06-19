import { UseFilters, UseGuards, UsePipes } from '@nestjs/common';
import {
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Util } from 'src/shared/util';
import { AuthenticationService } from '../authentication';
import { WSJwtGuard } from '../authentication/guards/ws-jwt.guard';
import { DatabaseService } from '../database/database.service';
import { RideStatus, RidesDocument } from '../database/schemas/rides.schema';
import {
  InactiveTripStatuses,
  TripStatus,
} from '../database/schemas/trips.schema';
import { UserDocument } from '../database/schemas/user.schema';
import { Logger } from '../logger/logger.service';
import { GeolocationService } from '../rides/geolocation.service';
import { CurrentClientUser } from '../shared/decorators/current-client-user.decorator';
import { WSValidationFilter } from '../shared/filter/ws-validation-filter';
import { ValidationPipe } from '../shared/pipes/validation.pipe';
import { DriverETADTO, RideLocationDTO } from './dto/websocket.dto';
import { WebsocketEvent, WebsocketEventType } from './types';

@WebSocketGateway({ transports: ['websocket'] })
@UseFilters(WSValidationFilter)
@UsePipes(ValidationPipe)
export class WebsocketGateway {
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

  async updateRideStatus(
    user: UserDocument,
    ride: string,
    coords: [number, number],
  ) {
    const trip = await this.db.trips.findOne({
      driver: user.id,
      ride,
      status: TripStatus.InProgress,
    });
    if (trip) {
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
    const ride = await this.db.rides.findOneAndUpdate(
      { driver: user.id },
      {
        $set: {
          location: {
            coordinates: [payload.lat, payload.lon],
            heading: payload.heading,
            type: 'Point',
          },
        },
      },
      { new: true },
    );

    this.updateRideStatus(user, ride.id, [payload.lat, payload.lon]);
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
