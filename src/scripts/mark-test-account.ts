import { connect, connection, disconnect } from 'mongoose';
import { getPlayReviewAccounts } from '../authentication/play-review-accounts';
import {
  TestAccountPurpose,
  TestAccountPurposes,
  UserSchema,
} from '../database/schemas/user.schema';
import config from '../shared/config';
import { DB_TABLES } from '../shared/constants';

const argument = (name: string) => {
  const prefix = `--${name}=`;
  return process.argv
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length);
};

async function markTestAccount() {
  const email = argument('email')?.trim().toLowerCase();
  const purpose = argument('purpose') as TestAccountPurpose | undefined;
  const confirmation = argument('confirm');
  if (!email || !purpose || !TestAccountPurposes.includes(purpose)) {
    throw new Error(
      'Usage: npm run mark:test-account -- --email=user@example.com --purpose=development|qa --confirm=user@example.com',
    );
  }
  if (purpose === TestAccountPurpose.AppReview) {
    throw new Error(
      'Use the app-review provisioning script for reviewer accounts',
    );
  }
  if (confirmation !== email) {
    throw new Error(`Confirmation must exactly match the email: ${email}`);
  }
  if (getPlayReviewAccounts().some((account) => account.email === email)) {
    throw new Error(
      'App-review accounts must be managed by the provisioning script',
    );
  }

  const databaseUrl = config().database.url;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const databaseName = new URL(databaseUrl).pathname.replace(/^\//, '');
  if (
    /prod/i.test(databaseName) &&
    !process.argv.includes('--allow-production')
  ) {
    throw new Error(
      `Refusing to modify ${databaseName} without the additional --allow-production flag`,
    );
  }

  await connect(databaseUrl);
  const UserModel = connection.model(DB_TABLES.USERS, UserSchema);
  const user = await UserModel.findOne({ email, deleted: { $ne: true } });
  if (!user) throw new Error('User not found');
  if (user.isAppAdmin)
    throw new Error('Administrator accounts cannot be marked as test');

  user.isTestAccount = true;
  user.testAccountPurpose = purpose;
  await user.save();
  // eslint-disable-next-line no-console
  console.log(
    `Marked ${email} as a ${purpose} test account in ${databaseName}`,
  );
}

markTestAccount()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => disconnect());
