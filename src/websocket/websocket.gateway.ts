import { UseFilters, UseGuards, UsePipes } from '@nestjs/common';
import {
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuthenticationService } from 'src/authentication';
import { WSJwtGuard } from 'src/authentication/guards/ws-jwt.guard';
import { DatabaseService } from 'src/database/database.service';
import { UserDocument } from 'src/database/schemas/user.schema';
import { Logger } from 'src/logger/logger.service';
import { CurrentClientUser } from 'src/shared/decorators/current-client-user.decorator';
import { WSValidationFilter } from 'src/shared/filter/ws-validation-filter';
import { ValidationPipe } from 'src/shared/pipes/validation.pipe';
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
      { $set: { 'location.coordinates': [payload.lat, payload.lon] } },
    );
  }
}
