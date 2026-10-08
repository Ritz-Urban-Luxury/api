import {
  getPlayReviewAccount,
  getPlayReviewAccounts,
  PLAY_REVIEW_PHONE_NUMBERS,
  playReviewOtpMatches,
} from './play-review-accounts';

const ENV_KEYS = [
  'PLAY_REVIEW_OTP',
  'PLAY_RIDER_REVIEW_EMAIL',
  'PLAY_RIDER_DELETE_REVIEW_EMAIL',
  'PLAY_DRIVER_REVIEW_EMAIL',
  'PLAY_DRIVER_DELETE_REVIEW_EMAIL',
] as const;

describe('Play review accounts', () => {
  const originalEnv = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]]),
  );

  beforeEach(() => {
    ENV_KEYS.forEach((key) => delete process.env[key]);
  });

  afterAll(() => {
    ENV_KEYS.forEach((key) => {
      const value = originalEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  });

  it('is disabled when reviewer secrets are absent', () => {
    expect(getPlayReviewAccounts()).toEqual([]);
  });

  it('matches only the configured OTP for the exact reviewer email', () => {
    process.env.PLAY_REVIEW_OTP = '1847';
    process.env.PLAY_RIDER_REVIEW_EMAIL = 'rider-review@ritzurbanluxury.com';
    process.env.PLAY_DRIVER_REVIEW_EMAIL = 'driver-review@ritzurbanluxury.com';

    const rider = getPlayReviewAccount(' Rider-Review@ritzurbanluxury.com ');
    if (!rider) {
      throw new Error('expected rider reviewer account');
    }
    expect(rider?.kind).toBe('rider');
    expect(playReviewOtpMatches(rider, '1847')).toBe(true);
    expect(playReviewOtpMatches(rider, '6305')).toBe(false);
    expect(getPlayReviewAccount('ordinary@example.com')).toBeNull();
  });

  it('attaches canonical phone numbers only to the rider accounts', () => {
    process.env.PLAY_REVIEW_OTP = '1847';
    process.env.PLAY_RIDER_REVIEW_EMAIL = 'rider-review@ritzurbanluxury.com';
    process.env.PLAY_RIDER_DELETE_REVIEW_EMAIL =
      'rider-delete-review@ritzurbanluxury.com';
    process.env.PLAY_DRIVER_REVIEW_EMAIL = 'driver-review@ritzurbanluxury.com';

    const accounts = getPlayReviewAccounts();
    const rider = accounts.find((account) => account.kind === 'rider');
    const riderDeletion = accounts.find(
      (account) => account.kind === 'riderDeletion',
    );
    const driver = accounts.find((account) => account.kind === 'driver');

    expect(rider?.phoneNumber).toBe(PLAY_REVIEW_PHONE_NUMBERS.rider);
    expect(rider?.phoneNumber).toBe('2347064192718');
    expect(riderDeletion?.phoneNumber).toBe('2347063650902');
    expect(driver?.phoneNumber).toBeUndefined();
  });

  it('rejects a malformed reviewer OTP', () => {
    process.env.PLAY_REVIEW_OTP = '123456';
    process.env.PLAY_RIDER_REVIEW_EMAIL = 'rider-review@ritzurbanluxury.com';
    expect(() => getPlayReviewAccounts()).toThrow('4 digits');
  });

  it('uses one shared OTP for every configured reviewer account', () => {
    process.env.PLAY_REVIEW_OTP = '1234';
    process.env.PLAY_RIDER_REVIEW_EMAIL = 'rider-review@ritzurbanluxury.com';
    process.env.PLAY_RIDER_DELETE_REVIEW_EMAIL =
      'rider-delete-review@ritzurbanluxury.com';
    process.env.PLAY_DRIVER_REVIEW_EMAIL = 'driver-review@ritzurbanluxury.com';
    process.env.PLAY_DRIVER_DELETE_REVIEW_EMAIL =
      'driver-delete-review@ritzurbanluxury.com';

    expect(getPlayReviewAccounts()).toHaveLength(4);
    expect(
      getPlayReviewAccounts().every((account) => account.otp === '1234'),
    ).toBe(true);
  });

  it('configures a distinct disposable driver account with the shared OTP', () => {
    process.env.PLAY_REVIEW_OTP = '1847';
    process.env.PLAY_DRIVER_DELETE_REVIEW_EMAIL =
      'driver-delete-review@ritzurbanluxury.com';

    const account = getPlayReviewAccount(
      'driver-delete-review@ritzurbanluxury.com',
    );

    expect(account).toMatchObject({
      kind: 'driverDeletion',
      otp: '1847',
    });
  });

  it('configures a distinct disposable rider account with canonical phone login', () => {
    process.env.PLAY_REVIEW_OTP = '1847';
    process.env.PLAY_RIDER_DELETE_REVIEW_EMAIL =
      'rider-delete-review@ritzurbanluxury.com';

    const account = getPlayReviewAccount(
      'rider-delete-review@ritzurbanluxury.com',
    );

    expect(account).toMatchObject({
      kind: 'riderDeletion',
      otp: '1847',
      phoneNumber: '2347063650902',
    });
  });
});
