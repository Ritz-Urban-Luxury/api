import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuthenticationService } from 'src/authentication';
import { UserDocument } from 'src/database/schemas/user.schema';
import { Logger } from 'src/logger/logger.service';
import { WebsocketEventType } from './types';

@WebSocketGateway({ transports: ['websocket'] })
export class WebsocketGateway {
  @WebSocketServer()
  private readonly server: Server;

  constructor(
    private readonly authenticationService: AuthenticationService,
    private readonly logger: Logger,
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
}
