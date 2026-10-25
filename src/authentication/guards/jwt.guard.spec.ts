import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AdminJwtGuard, JwtGuard } from './jwt.guard';

describe('JWT guards', () => {
  const context = {} as ExecutionContext;

  it.each([new JwtGuard(), new AdminJwtGuard()])(
    'returns a valid user without delegating to Passport error logging',
    (guard) => {
      const user = { id: 'user-1' };
      expect(guard.handleRequest(null, user, undefined, context)).toBe(user);
    },
  );

  it.each([new JwtGuard(), new AdminJwtGuard()])(
    'returns a clean unauthorized exception when the account is gone',
    (guard) => {
      expect(() => guard.handleRequest(null, null, undefined, context)).toThrow(
        UnauthorizedException,
      );
    },
  );
});
