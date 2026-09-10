import { ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

export class WSJwtGuard extends AuthGuard('ws-jwt') {
  getRequest(context: ExecutionContext) {
    return context.switchToWs().getClient();
  }
}
