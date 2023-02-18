import { Global, Module } from '@nestjs/common';
import { AuthenticationModule } from 'src/authentication';
import { WebsocketGateway } from './websocket.gateway';

@Global()
@Module({
  imports: [AuthenticationModule],
  providers: [WebsocketGateway],
  exports: [WebsocketGateway],
})
export class WebsocketModule {}
