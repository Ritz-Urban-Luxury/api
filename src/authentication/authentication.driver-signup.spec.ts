import { AuthenticationService } from './authentication.service';

describe('AuthenticationService driver signup', () => {
  it('keeps the shared rider signup endpoint as a rider account', async () => {
    const createUser = jest.fn((user: Record<string, unknown>) => ({
      id: 'rider-id',
      ...user,
    }));
    const service = Object.create(AuthenticationService.prototype) as {
      activityLedger: { recordActivity: jest.Mock };
      authorizeUser: jest.Mock;
      db: {
        users: {
          create: typeof createUser;
          findOne: jest.Mock;
        };
      };
      referralService: { ensureInviteCode: jest.Mock };
      signUp: AuthenticationService['signUp'];
    };
    service.db = {
      users: {
        create: createUser,
        findOne: jest.fn().mockResolvedValue(null),
      },
    };
    service.activityLedger = { recordActivity: jest.fn() };
    service.referralService = { ensureInviteCode: jest.fn() };
    service.authorizeUser = jest.fn().mockResolvedValue({ token: 'token' });

    await service.signUp({
      email: 'rider@example.com',
      firstName: undefined,
      lastName: undefined,
    });

    expect(service.db.users.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'rider@example.com',
        isDriver: false,
      }),
    );
    expect(service.db.users.create.mock.calls[0][0].isVerified).toBeUndefined();
  });

  it('resolves an active location and forwards the verified phone OTP', async () => {
    const signUp = jest.fn().mockResolvedValue({ token: 'token' });
    const service = Object.create(AuthenticationService.prototype) as {
      locationsService: { getActiveOrFail: jest.Mock };
      signUp: typeof signUp;
      signUpDriver: AuthenticationService['signUpDriver'];
    };
    service.locationsService = {
      getActiveOrFail: jest
        .fn()
        .mockResolvedValue({ id: 'location-id', name: 'Lagos' }),
    };
    service.signUp = signUp;

    await expect(
      service.signUpDriver({
        email: 'driver@example.com',
        locationId: 'location-id',
        phoneNumber: '08012345678',
        phoneOtp: '1234',
      }),
    ).resolves.toEqual({ token: 'token' });

    expect(service.signUp).toHaveBeenCalledWith(
      {
        city: 'Lagos',
        email: 'driver@example.com',
        firstName: undefined,
        lastName: undefined,
        phoneNumber: '08012345678',
        phoneOtp: '1234',
        serviceLocation: 'location-id',
        vehiclesInFleet: undefined,
      },
      { isDriver: true },
    );
  });
});
