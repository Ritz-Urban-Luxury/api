import { BadRequestException } from '@nestjs/common';
import { AuthenticationService } from './authentication.service';

describe('AuthenticationService.changePassword', () => {
  const setup = (overrides: Record<string, unknown> = {}) => {
    const user = {
      id: 'user-1',
      password: 'stored-hash',
      mustChangePassword: true,
      isValidPassword: jest.fn(
        async (candidate: string) => candidate === 'Old12345',
      ),
      save: jest.fn(async () => undefined),
      ...overrides,
    };
    const db = { users: { findOne: jest.fn(async () => user) } };
    const jwt = { sign: jest.fn(() => 'new-token') };
    const service = new AuthenticationService(
      {} as never,
      {} as never,
      jwt as never,
      {} as never,
      db as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, user };
  };

  it('lets an admin-created account set a password without the current one', async () => {
    const { service, user } = setup();

    const result = await service.changePassword({ id: 'user-1' } as never, {
      password: 'NewPass123',
    });

    expect(user.password).toBe('NewPass123');
    expect(user.mustChangePassword).toBe(false);
    expect(user.save).toHaveBeenCalled();
    expect(result.token).toBe('new-token');
  });

  it('requires the current password once the account has its own password', async () => {
    const { service, user } = setup({ mustChangePassword: false });

    await expect(
      service.changePassword({ id: 'user-1' } as never, {
        password: 'NewPass123',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(user.save).not.toHaveBeenCalled();

    await expect(
      service.changePassword({ id: 'user-1' } as never, {
        currentPassword: 'Old12345',
        password: 'NewPass123',
      }),
    ).resolves.toEqual(expect.objectContaining({ token: 'new-token' }));
  });

  it('rejects reusing the temporary password', async () => {
    const { service } = setup();

    await expect(
      service.changePassword({ id: 'user-1' } as never, {
        password: 'Old12345',
      }),
    ).rejects.toThrow('choose a password different from your current one');
  });
});
