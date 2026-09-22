import {
  getPlayReviewAccount,
  getPlayReviewAccounts,
  PLAY_REVIEW_PHONE_NUMBERS,
  playReviewOtpMatches,
} from './play-review-accounts';

const ENV_KEYS = [
  'PLAY_RIDER_REVIEW_EMAIL',
  'PLAY_RIDER_REVIEW_OTP',
  'PLAY_RIDER_REVIEW_PHONE_NUMBER',
  'PLAY_RIDER_DELETE_REVIEW_EMAIL',
  'PLAY_RIDER_DELETE_REVIEW_OTP',
  'PLAY_RIDER_DELETE_REVIEW_PHONE_NUMBER',
  'PLAY_DRIVER_REVIEW_EMAIL',
  'PLAY_DRIVER_REVIEW_OTP',
  'PLAY_DRIVER_DELETE_REVIEW_EMAIL',
  'PLAY_DRIVER_DELETE_REVIEW_OTP',
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
    process.env.PLAY_RIDER_REVIEW_EMAIL = 'rider-review@ritzurbanluxury.com';
    process.env.PLAY_RIDER_REVIEW_OTP = '1847';
    process.env.PLAY_DRIVER_REVIEW_EMAIL = 'driver-review@ritzurbanluxury.com';
    process.env.PLAY_DRIVER_REVIEW_OTP = '6305';

    const rider = getPlayReviewAccount(' Rider-Review@ritzurbanluxury.com ');
    if (!rider) {
      throw new Error('expected rider reviewer account');
    }
    expect(rider?.kind).toBe('rider');
    expect(playReviewOtpMatches(rider, '1847')).toBe(true);
    expect(playReviewOtpMatches(rider, '6305')).toBe(false);
    expect(getPlayReviewAccount('ordinary@example.com')).toBeNull();
  });

  it('attaches the fixed reviewer phone number only to the rider account', () => {
    process.env.PLAY_RIDER_REVIEW_EMAIL = 'rider-review@ritzurbanluxury.com';
    process.env.PLAY_RIDER_REVIEW_OTP = '1847';
    process.env.PLAY_DRIVER_REVIEW_EMAIL = 'driver-review@ritzurbanluxury.com';
    process.env.PLAY_DRIVER_REVIEW_OTP = '6305';

    const [rider, driver] = getPlayReviewAccounts().sort((a) =>
      a.kind === 'rider' ? -1 : 1,
    );

    expect(rider.phoneNumber).toBe(PLAY_REVIEW_PHONE_NUMBERS.rider);
    expect(rider.phoneNumber).toBe('2347063650901');
    expect(driver.phoneNumber).toBeUndefined();
  });

  it('rejects malformed or shared reviewer secrets', () => {
    process.env.PLAY_RIDER_REVIEW_EMAIL = 'rider-review@ritzurbanluxury.com';
    process.env.PLAY_RIDER_REVIEW_OTP = '123456';
    expect(() => getPlayReviewAccounts()).toThrow('4 digits');

    process.env.PLAY_RIDER_REVIEW_OTP = '1234';
    process.env.PLAY_DRIVER_REVIEW_EMAIL = 'driver-review@ritzurbanluxury.com';
    process.env.PLAY_DRIVER_REVIEW_OTP = '1234';
    expect(() => getPlayReviewAccounts()).toThrow('must be different');
  });

  it('configures a distinct disposable driver account for deletion review', () => {
    process.env.PLAY_DRIVER_DELETE_REVIEW_EMAIL =
      'driver-delete-review@ritzurbanluxury.com';
    process.env.PLAY_DRIVER_DELETE_REVIEW_OTP = '9274';

    const account = getPlayReviewAccount(
      'driver-delete-review@ritzurbanluxury.com',
    );

    expect(account).toMatchObject({
      kind: 'driverDeletion',
      otp: '9274',
    });
  });

  it('configures a distinct disposable rider account with phone login', () => {
    process.env.PLAY_RIDER_DELETE_REVIEW_EMAIL =
      'rider-delete-review@ritzurbanluxury.com';
    process.env.PLAY_RIDER_DELETE_REVIEW_OTP = '5182';
    process.env.PLAY_RIDER_DELETE_REVIEW_PHONE_NUMBER = '07063650902';

    const account = getPlayReviewAccount(
      'rider-delete-review@ritzurbanluxury.com',
    );

    expect(account).toMatchObject({
      kind: 'riderDeletion',
      otp: '5182',
      phoneNumber: '2347063650902',
    });
  });

  it('allows the reusable rider phone number to be configured', () => {
    process.env.PLAY_RIDER_REVIEW_EMAIL = 'rider-review@ritzurbanluxury.com';
    process.env.PLAY_RIDER_REVIEW_OTP = '1847';
    process.env.PLAY_RIDER_REVIEW_PHONE_NUMBER = '08012345678';

    expect(
      getPlayReviewAccount('rider-review@ritzurbanluxury.com'),
    ).toMatchObject({ phoneNumber: '2348012345678' });
  });
});
