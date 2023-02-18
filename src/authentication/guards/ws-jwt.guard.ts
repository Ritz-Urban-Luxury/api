import { AuthGuard } from '@nestjs/passport';

export class WSJwtGuard extends AuthGuard('ws-jwt') {}
