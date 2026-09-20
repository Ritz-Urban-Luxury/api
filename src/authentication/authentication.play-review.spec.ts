import { UnauthorizedException } from '@nestjs/common';
import { AuthenticationService } from './authentication.service';

describe('AuthenticationService Play reviewer authentication', () => {
  const reviewerUser = {
    email: 'rider-review@ritzurbanluxury.com',
    id: 'reviewer-user-id',
    isAppAdmin: false,
    isDriver: false,
    isVerified: false,
    password: 'already-hashed-password',
    phoneNumber: '2347063650901',
  };

  const createService = (failedAttempts = 0) => {
    process.env.PLAY_RIDER_REVIEW_EMAIL = 'rider-review@ritzurbanluxury.com';
    process.env.PLAY_RIDER_REVIEW_OTP = '1847';
    process.env.PLAY_DRIVER_REVIEW_EMAIL = 'driver-review@ritzurbanluxury.com';
    process.env.PLAY_DRIVER_REVIEW_OTP = '6305';

    const notificationService = {
      sendEmail: jest.fn(),
      sendSMS: jest.fn(),
    };
    const logger = {
      error: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
    };
    const jwtService = { sign: jest.fn().mockReturnValue('reviewer-jwt') };
    const db = {
      authTokens: {
        countDocuments: jest.fn().mockResolvedValue(failedAttempts),
        create: jest.fn().mockResolvedValue({}),
        findOne: jest.fn().mockResolvedValue(null),
        updateOne: jest.fn(),
      },
      users: {
        findOne: jest.fn().mockResolvedValue(reviewerUser),
      },
    };

    const service = new AuthenticationService(
      notificationService as never,
      logger as never,
      jwtService as never,
      {} as never,
      db as never,
      {} as never,
      {} as never,
    );

    return { db, jwtService, logger, notificationService, service };
  };

  afterEach(() => {
    delete process.env.PLAY_RIDER_REVIEW_EMAIL;
    delete process.env.PLAY_RIDER_REVIEW_OTP;
    delete process.env.PLAY_DRIVER_REVIEW_EMAIL;
    delete process.env.PLAY_DRIVER_REVIEW_OTP;
  });

  it('skips email delivery and stores only an opaque request marker', async () => {
    const { db, logger, notificationService, service } = createService();

    await service.requestEmailOtp({
      email: 'RIDER-REVIEW@ritzurbanluxury.com',
    });

    expect(notificationService.sendEmail).not.toHaveBeenCalled();
    expect(db.authTokens.create).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: {
          email: 'rider-review@ritzurbanluxury.com',
          type: 'play-review-email-otp-request',
        },
        token: expect.stringMatching(/^[a-f\d]{64}$/),
      }),
    );
    expect(logger.log).toHaveBeenCalledWith(
      'Play reviewer OTP requested',
      expect.objectContaining({ reviewerType: 'rider' }),
    );
  });

  it('authorizes the exact reviewer account with its reusable OTP', async () => {
    const { db, jwtService, service } = createService();

    await expect(
      service.login({
        identifier: 'rider-review@ritzurbanluxury.com',
        otp: '1847',
      }),
    ).resolves.toEqual({ token: 'reviewer-jwt', user: reviewerUser });

    expect(jwtService.sign).toHaveBeenCalled();
    expect(db.authTokens.create).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({
          email: reviewerUser.email,
          success: true,
          type: 'play-review-otp-attempt',
        }),
      }),
    );
  });

  it('rejects a wrong fixed OTP without falling back to ordinary OTPs', async () => {
    const { db, service } = createService();

    await expect(
      service.login({
        identifier: reviewerUser.email,
        otp: '9999',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(db.authTokens.findOne).not.toHaveBeenCalled();
  });

  it('rate-limits repeated reviewer OTP failures', async () => {
    const { db, service } = createService(5);

    await expect(
      service.login({
        identifier: reviewerUser.email,
        otp: '1847',
      }),
    ).rejects.toMatchObject({ status: 429 });

    expect(db.authTokens.create).not.toHaveBeenCalled();
  });

  // Real riders sign in with Google or a phone number, never email, so the
  // rider reviewer must also be reachable through the phone-OTP flow.
  it('skips SMS delivery and stores only an opaque request marker for the reviewer phone number', async () => {
    const { db, notificationService, service } = createService();

    await service.requestPhoneOtp({ phoneNumber: '07063650901' });

    expect(notificationService.sendSMS).not.toHaveBeenCalled();
    expect(db.authTokens.create).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: {
          phoneNumber: '2347063650901',
          type: 'play-review-phone-otp-request',
        },
        token: expect.stringMatching(/^[a-f\d]{64}$/),
      }),
    );
  });

  it('authorizes the reviewer phone number with its reusable OTP', async () => {
    const { db, jwtService, service } = createService();

    await expect(
      service.login({
        phoneNumber: '07063650901',
        otp: '1847',
      }),
    ).resolves.toEqual({ token: 'reviewer-jwt', user: reviewerUser });

    expect(jwtService.sign).toHaveBeenCalled();
    expect(db.authTokens.create).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({
          email: reviewerUser.email,
          success: true,
          type: 'play-review-otp-attempt',
        }),
      }),
    );
  });

  it('rejects a wrong fixed OTP on the reviewer phone number without falling back to ordinary OTPs', async () => {
    const { db, service } = createService();

    await expect(
      service.login({
        phoneNumber: '07063650901',
        otp: '9999',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(db.authTokens.findOne).not.toHaveBeenCalled();
  });

  it('does not intercept an ordinary phone number', async () => {
    const { db, service } = createService();
    db.users.findOne.mockResolvedValueOnce(null);

    await expect(
      service.login({
        phoneNumber: '08011112222',
        otp: '1847',
      }),
    ).rejects.toThrow();

    // Falls through to the real phone-OTP lookup instead of the reviewer
    // bypass, which never touches authTokens.findOne.
    expect(db.authTokens.findOne).toHaveBeenCalled();
  });
});
