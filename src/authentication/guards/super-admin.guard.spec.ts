import { ExecutionContext } from '@nestjs/common';
import { AdminRole } from '../../database/schemas/user.schema';
import { SuperAdminGuard } from './super-admin.guard';

describe('SuperAdminGuard', () => {
  const context = (user: Record<string, unknown>) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as unknown as ExecutionContext);

  it('allows a super administrator', () => {
    expect(
      new SuperAdminGuard().canActivate(
        context({ adminRole: AdminRole.SuperAdmin, isAppAdmin: true }),
      ),
    ).toBe(true);
  });

  it('rejects a regular administrator', () => {
    expect(
      new SuperAdminGuard().canActivate(
        context({ adminRole: AdminRole.Admin, isAppAdmin: true }),
      ),
    ).toBe(false);
  });
});
