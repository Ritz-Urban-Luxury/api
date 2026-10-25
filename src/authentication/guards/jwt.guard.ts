import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

class QuietJwtGuard extends AuthGuard('jwt') {
  handleRequest<TUser = unknown>(
    error: Error | null,
    user: TUser | null | false,
    _info: unknown,
    _context: ExecutionContext,
  ): TUser {
    if (error) throw error;
    if (!user) throw new UnauthorizedException();
    return user;
  }
}

export class JwtGuard extends QuietJwtGuard {}

export class AdminJwtGuard extends AuthGuard('admin-jwt') {
  handleRequest<TUser = unknown>(
    error: Error | null,
    user: TUser | null | false,
    _info: unknown,
    _context: ExecutionContext,
  ): TUser {
    if (error) throw error;
    if (!user) throw new UnauthorizedException();
    return user;
  }
}
