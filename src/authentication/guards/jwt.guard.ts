import { AuthGuard } from '@nestjs/passport';

export class JwtGuard extends AuthGuard('jwt') {}

export class AdminJwtGuard extends AuthGuard('admin-jwt') {}
