import { validateEnvironmentSafety } from './environment-safety';

describe('validateEnvironmentSafety', () => {
  const originalEnvironment = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnvironment,
      APP_ENV: 'development',
      DATABASE_URL: 'mongodb://localhost:27017/rul-development',
      PAYSTACK_MODE: 'test',
      PAYSTACK_SECRET_KEY: 'sk_test_example',
    };
    delete process.env.ALLOW_PRODUCTION_DATABASE_IN_NON_PRODUCTION;
  });

  afterAll(() => {
    process.env = originalEnvironment;
  });

  it('accepts an isolated development database and test payment key', () => {
    expect(() => validateEnvironmentSafety()).not.toThrow();
  });

  it('rejects a development service pointed at production data', () => {
    process.env.DATABASE_URL = 'mongodb://localhost:27017/rul-prod';

    expect(() => validateEnvironmentSafety()).toThrow(
      'Refusing to start development against production database "rul-prod"',
    );
  });

  it('rejects live payments outside production', () => {
    process.env.PAYSTACK_MODE = 'live';
    process.env.PAYSTACK_SECRET_KEY_LIVE = 'sk_live_example';

    expect(() => validateEnvironmentSafety()).toThrow(
      'development must use PAYSTACK_MODE=test',
    );
  });

  it('requires production to use a production database and live key', () => {
    process.env.APP_ENV = 'production';
    process.env.PAYSTACK_MODE = 'live';
    process.env.PAYSTACK_SECRET_KEY_LIVE = 'sk_live_example';

    expect(() => validateEnvironmentSafety()).toThrow(
      'Refusing to start production against non-production database',
    );

    process.env.DATABASE_URL = 'mongodb://localhost:27017/rul-production';
    expect(() => validateEnvironmentSafety()).not.toThrow();
  });

  it('does not allow production to start without a live Paystack key', () => {
    process.env.APP_ENV = 'production';
    process.env.DATABASE_URL = 'mongodb://localhost:27017/rul-production';
    process.env.PAYSTACK_MODE = 'live';
    delete process.env.PAYSTACK_SECRET_KEY_LIVE;

    expect(() => validateEnvironmentSafety()).toThrow(
      'PAYSTACK_MODE=live requires a live Paystack secret key',
    );
  });
});
