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
import { RidesDocument } from '../database/schemas/rides.schema';
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
import { RideLocationDTO } from './dto/websocket.dto';
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

  // Subscriptions
  @UseGuards(WSJwtGuard)
  @SubscribeMessage(WebsocketEvent.RideLocation)
  async updateRideLocation(
    @CurrentClientUser() user: UserDocument,
    @MessageBody() payload: RideLocationDTO,
  ) {
    await this.db.rides.updateOne(
      { _id: payload.ride, driver: user.id },
      {
        $set: {
          'location.coordinates': [payload.lat, payload.lon],
          'location.heading': payload.heading,
        },
      },
    );
  }

  @UseGuards(WSJwtGuard)
  @SubscribeMessage(WebsocketEvent.RideETA)
  async getDriverETA(@CurrentClientUser() user: UserDocument) {
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
          : trip.to.coordinates;
      const eta = await GeolocationService.getETA(
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
