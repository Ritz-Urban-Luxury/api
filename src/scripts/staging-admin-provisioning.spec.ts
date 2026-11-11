import {
  databaseNameFromUrl,
  validateStagingAdminProvisioning,
} from './staging-admin-provisioning';

const validInput = {
  appEnvironment: 'staging',
  confirmationDatabase: 'rul-staging',
  confirmationEmail: 'admin@example.com',
  databaseUrl: 'mongodb+srv://user:password@example.mongodb.net/rul-staging',
  email: 'ADMIN@example.com ',
  password: 'a-long-staging-password',
};

describe('staging admin provisioning safeguards', () => {
  it('normalizes a fully confirmed staging configuration', () => {
    expect(validateStagingAdminProvisioning(validInput)).toEqual({
      databaseName: 'rul-staging',
      databaseUrl: validInput.databaseUrl,
      email: 'admin@example.com',
      password: validInput.password,
    });
  });

  it('extracts an encoded database name', () => {
    expect(
      databaseNameFromUrl('mongodb://localhost:27017/ritz%20staging'),
    ).toBe('ritz staging');
  });

  it('refuses to run outside the staging environment', () => {
    expect(() =>
      validateStagingAdminProvisioning({
        ...validInput,
        appEnvironment: 'production',
      }),
    ).toThrow('APP_ENV=staging');
  });

  it('refuses production-like database names even when APP_ENV is spoofed', () => {
    expect(() =>
      validateStagingAdminProvisioning({
        ...validInput,
        confirmationDatabase: 'rul-production',
        databaseUrl:
          'mongodb+srv://user:password@example.mongodb.net/rul-production',
      }),
    ).toThrow('production-like database');
  });

  it('requires exact email and database confirmations', () => {
    expect(() =>
      validateStagingAdminProvisioning({
        ...validInput,
        confirmationEmail: 'other@example.com',
      }),
    ).toThrow('Email confirmation');
    expect(() =>
      validateStagingAdminProvisioning({
        ...validInput,
        confirmationDatabase: 'another-database',
      }),
    ).toThrow('Database confirmation');
  });

  it('requires a sufficiently long password', () => {
    expect(() =>
      validateStagingAdminProvisioning({
        ...validInput,
        password: 'too-short',
      }),
    ).toThrow('at least 12 characters');
  });
});
