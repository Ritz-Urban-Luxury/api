import { hash } from 'bcryptjs';
import { connect, connection, disconnect } from 'mongoose';
import {
  AdminRole,
  TestAccountPurpose,
  UserSchema,
} from '../database/schemas/user.schema';
import config from '../shared/config';
import { DB_TABLES } from '../shared/constants';
import { validateStagingAdminProvisioning } from './staging-admin-provisioning';

const argument = (name: string) => {
  const prefix = `--${name}=`;
  return process.argv
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length);
};

async function provisionStagingAdmin() {
  const provisioning = validateStagingAdminProvisioning({
    appEnvironment: config().appEnvironment,
    confirmationDatabase: argument('confirm-database'),
    confirmationEmail: argument('confirm-email'),
    databaseUrl: config().database.url,
    email: process.env.STAGING_ADMIN_EMAIL,
    password: process.env.STAGING_ADMIN_PASSWORD,
  });

  await connect(provisioning.databaseUrl);
  const UserModel = connection.model(DB_TABLES.USERS, UserSchema);
  const password = await hash(provisioning.password, 8);
  const existing = await UserModel.findOne({
    email: provisioning.email,
  })
    .select('_id')
    .lean();

  const user = await UserModel.findOneAndUpdate(
    { email: provisioning.email },
    {
      $set: {
        adminRole: AdminRole.Admin,
        billingType: 'individual',
        deleted: false,
        email: provisioning.email,
        firstName: process.env.STAGING_ADMIN_FIRST_NAME?.trim() || 'Staging',
        isAppAdmin: true,
        isDriver: false,
        isTestAccount: true,
        isVerified: true,
        lastName: process.env.STAGING_ADMIN_LAST_NAME?.trim() || 'Admin',
        password,
        testAccountPurpose: TestAccountPurpose.QA,
        'preferences.stagingAdmin': true,
      },
      $unset: {
        deletedAt: 1,
        deletionRequestedAt: 1,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  if (!user) throw new Error('Staging administrator could not be provisioned');

  // Never print the password or database URL; deployment logs are not a
  // credential store.
  // eslint-disable-next-line no-console
  console.log(
    `${existing ? 'Updated' : 'Created'} staging administrator ${
      provisioning.email
    } in ${provisioning.databaseName}`,
  );
}

provisionStagingAdmin()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => disconnect());
