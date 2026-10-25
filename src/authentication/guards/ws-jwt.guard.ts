import { ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';

export class WSJwtGuard extends AuthGuard('ws-jwt') {
  getRequest(context: ExecutionContext) {
    return context.switchToWs().getClient();
  }

  handleRequest<TUser = unknown>(
    error: Error | null,
    user: TUser | null | false,
    _info: unknown,
    context: ExecutionContext,
  ): TUser {
    if (error || !user) {
      context.switchToWs().getClient<Socket>().disconnect(true);
      throw new WsException('Unauthorized');
    }

    return user;
  }
}
