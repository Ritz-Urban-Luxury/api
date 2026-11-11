export type StagingAdminProvisioningInput = {
  appEnvironment?: string;
  confirmationDatabase?: string;
  confirmationEmail?: string;
  databaseUrl?: string;
  email?: string;
  password?: string;
};

export type StagingAdminProvisioningConfig = {
  databaseName: string;
  databaseUrl: string;
  email: string;
  password: string;
};

const normalize = (value?: string) => value?.trim();

export const databaseNameFromUrl = (databaseUrl: string): string => {
  try {
    return decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''));
  } catch {
    throw new Error('DATABASE_URL must be a valid MongoDB URL');
  }
};

export const validateStagingAdminProvisioning = ({
  appEnvironment,
  confirmationDatabase,
  confirmationEmail,
  databaseUrl,
  email,
  password,
}: StagingAdminProvisioningInput): StagingAdminProvisioningConfig => {
  if (normalize(appEnvironment)?.toLowerCase() !== 'staging') {
    throw new Error('Refusing to provision an admin unless APP_ENV=staging');
  }

  const normalizedEmail = normalize(email)?.toLowerCase();
  if (!normalizedEmail || !/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
    throw new Error('STAGING_ADMIN_EMAIL must be a valid email address');
  }

  const normalizedPassword = normalize(password);
  if (!normalizedPassword || normalizedPassword.length < 12) {
    throw new Error(
      'STAGING_ADMIN_PASSWORD must contain at least 12 characters',
    );
  }

  const normalizedDatabaseUrl = normalize(databaseUrl);
  if (!normalizedDatabaseUrl) throw new Error('DATABASE_URL is required');

  const databaseName = databaseNameFromUrl(normalizedDatabaseUrl);
  if (!databaseName) {
    throw new Error('DATABASE_URL must include an explicit database name');
  }
  if (/prod(?:uction)?/i.test(databaseName)) {
    throw new Error(
      `Refusing to modify production-like database ${databaseName}`,
    );
  }

  if (normalize(confirmationEmail)?.toLowerCase() !== normalizedEmail) {
    throw new Error(`Email confirmation must exactly match ${normalizedEmail}`);
  }
  if (normalize(confirmationDatabase) !== databaseName) {
    throw new Error(`Database confirmation must exactly match ${databaseName}`);
  }

  return {
    databaseName,
    databaseUrl: normalizedDatabaseUrl,
    email: normalizedEmail,
    password: normalizedPassword,
  };
};
