import { BadRequestException } from '@nestjs/common';
import { TestAccountPurpose } from '../database/schemas/user.schema';
import { AuthenticationService } from './authentication.service';

describe('AuthenticationService driver signup', () => {
  const originalEnvironment = process.env;

  afterEach(() => {
    process.env = { ...originalEnvironment };
  });

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

  it('marks the complete staging registration identity as a QA test account', async () => {
    process.env.APP_ENV = 'staging';
    process.env.DRIVER_REGISTRATION_TEST_OTP = '2468';
    const signUp = jest.fn().mockResolvedValue({ token: 'token' });
    const service = Object.create(AuthenticationService.prototype) as {
      locationsService: { getActiveOrFail: jest.Mock };
      signUp: typeof signUp;
      signUpDriver: AuthenticationService['signUpDriver'];
    };
    service.locationsService = {
      getActiveOrFail: jest
        .fn()
        .mockResolvedValue({ id: 'location-id', name: 'Abuja' }),
    };
    service.signUp = signUp;

    await service.signUpDriver({
      email: 'test@ritzurbanluxury.com',
      locationId: 'location-id',
      phoneNumber: '07000000001',
      phoneOtp: '2468',
    });

    expect(signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'test@ritzurbanluxury.com',
        phoneNumber: '07000000001',
      }),
      {
        isDriver: true,
        testAccountPurpose: TestAccountPurpose.QA,
      },
    );
  });

  it('rejects a partial or mismatched staging registration identity', async () => {
    process.env.APP_ENV = 'staging';
    process.env.DRIVER_REGISTRATION_TEST_OTP = '2468';
    const service = Object.create(AuthenticationService.prototype) as {
      locationsService: { getActiveOrFail: jest.Mock };
      signUp: jest.Mock;
      signUpDriver: AuthenticationService['signUpDriver'];
    };
    service.locationsService = {
      getActiveOrFail: jest
        .fn()
        .mockResolvedValue({ id: 'location-id', name: 'Abuja' }),
    };
    service.signUp = jest.fn();

    await expect(
      service.signUpDriver({
        email: 'someone@example.com',
        locationId: 'location-id',
        phoneNumber: '07000000001',
        phoneOtp: '2468',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.signUp).not.toHaveBeenCalled();
  });

  it('creates a normal fixed OTP without sending SMS for the staging test number', async () => {
    process.env.APP_ENV = 'staging';
    process.env.DRIVER_REGISTRATION_TEST_OTP = '2468';
    process.env.PLAY_REVIEW_OTP = '1847';
    process.env.PLAY_RIDER_REVIEW_EMAIL = 'rider-review@ritzurbanluxury.com';
    process.env.PLAY_DRIVER_REVIEW_EMAIL = 'driver-review@ritzurbanluxury.com';
    const notificationService = { sendEmail: jest.fn(), sendSMS: jest.fn() };
    const logger = { error: jest.fn(), log: jest.fn(), warn: jest.fn() };
    const db = {
      authTokens: {
        create: jest.fn().mockResolvedValue({}),
        findOne: jest.fn().mockResolvedValue(null),
      },
    };
    const service = new AuthenticationService(
      notificationService as never,
      logger as never,
      {} as never,
      {} as never,
      db as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.requestPhoneOtp({
      app: 'driver',
      phoneNumber: '07000000001',
    });

    expect(notificationService.sendSMS).not.toHaveBeenCalled();
    expect(db.authTokens.create).toHaveBeenCalledWith(
      expect.objectContaining({
        token: expect.stringMatching(/^[a-f\d]{64}$/),
        tokenHash: expect.any(String),
        meta: {
          phoneNumber: '2347000000001',
          type: 'phone-otp',
        },
      }),
    );
    expect(logger.log).toHaveBeenCalledWith(
      'Driver registration test OTP requested',
      { phoneNumber: '2347000000001' },
    );
  });

  it('creates the fixed OTP without sending email for the staging test email', async () => {
    process.env.APP_ENV = 'staging';
    process.env.DRIVER_REGISTRATION_TEST_OTP = '2468';
    const notificationService = { sendEmail: jest.fn(), sendSMS: jest.fn() };
    const logger = { error: jest.fn(), log: jest.fn(), warn: jest.fn() };
    const db = {
      authTokens: {
        create: jest.fn().mockResolvedValue({}),
        findOne: jest.fn().mockResolvedValue(null),
      },
    };
    const service = new AuthenticationService(
      notificationService as never,
      logger as never,
      {} as never,
      {} as never,
      db as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.requestEmailOtp({
      app: 'driver',
      email: 'TEST@ritzurbanluxury.com',
    });

    expect(notificationService.sendEmail).not.toHaveBeenCalled();
    expect(db.authTokens.create).toHaveBeenCalledWith(
      expect.objectContaining({
        token: expect.stringMatching(/^[a-f\d]{64}$/),
        tokenHash: expect.any(String),
        meta: {
          email: 'test@ritzurbanluxury.com',
          type: 'email-otp',
        },
      }),
    );
    expect(logger.log).toHaveBeenCalledWith(
      'Driver registration test email OTP requested',
      { email: 'test@ritzurbanluxury.com' },
    );
  });
});
