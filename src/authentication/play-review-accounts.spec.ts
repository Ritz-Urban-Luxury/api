import {
  getPlayReviewAccount,
  getPlayReviewAccounts,
  playReviewOtpMatches,
} from './play-review-accounts';

const ENV_KEYS = [
  'PLAY_RIDER_REVIEW_EMAIL',
  'PLAY_RIDER_REVIEW_OTP',
  'PLAY_DRIVER_REVIEW_EMAIL',
  'PLAY_DRIVER_REVIEW_OTP',
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

  it('rejects malformed or shared reviewer secrets', () => {
    process.env.PLAY_RIDER_REVIEW_EMAIL = 'rider-review@ritzurbanluxury.com';
    process.env.PLAY_RIDER_REVIEW_OTP = '123456';
    expect(() => getPlayReviewAccounts()).toThrow('4 digits');

    process.env.PLAY_RIDER_REVIEW_OTP = '1234';
    process.env.PLAY_DRIVER_REVIEW_EMAIL = 'driver-review@ritzurbanluxury.com';
    process.env.PLAY_DRIVER_REVIEW_OTP = '1234';
    expect(() => getPlayReviewAccounts()).toThrow('must be different');
  });
});
