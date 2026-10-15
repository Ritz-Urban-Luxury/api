import config, { AppEnvironment, PaystackMode } from './config';

const databaseName = (databaseUrl?: string): string => {
  if (!databaseUrl) return '';
  try {
    return new URL(databaseUrl).pathname.replace(/^\//, '').split('?')[0];
  } catch {
    return '';
  }
};

const isProductionDatabaseName = (name: string) =>
  /(^|[-_])prod(uction)?($|[-_])/i.test(name);

export function validateEnvironmentSafety(): void {
  const runtime = config();
  const environment = runtime.appEnvironment as AppEnvironment;
  const mode = runtime.paystack.mode as PaystackMode;
  const dbName = databaseName(runtime.database.url);
  const secret = runtime.paystack.secretKey?.trim() || '';

  if (!runtime.database.url) {
    throw new Error('DATABASE_URL is required');
  }
  if (!dbName) {
    throw new Error('DATABASE_URL must include an explicit database name');
  }
  if (environment === 'production' && mode !== 'live') {
    throw new Error('Production must use PAYSTACK_MODE=live');
  }
  if (environment !== 'production' && mode !== 'test') {
    throw new Error(`${environment} must use PAYSTACK_MODE=test`);
  }
  if (mode === 'live' && !secret.startsWith('sk_live_')) {
    throw new Error('PAYSTACK_MODE=live requires a live Paystack secret key');
  }
  if (mode === 'test' && secret && !secret.startsWith('sk_test_')) {
    throw new Error('PAYSTACK_MODE=test requires a test Paystack secret key');
  }
  if (
    environment !== 'production' &&
    isProductionDatabaseName(dbName) &&
    process.env.ALLOW_PRODUCTION_DATABASE_IN_NON_PRODUCTION !== 'true'
  ) {
    throw new Error(
      `Refusing to start ${environment} against production database "${dbName}"`,
    );
  }
  if (environment === 'production' && !isProductionDatabaseName(dbName)) {
    throw new Error(
      `Refusing to start production against non-production database "${dbName}"`,
    );
  }
}
