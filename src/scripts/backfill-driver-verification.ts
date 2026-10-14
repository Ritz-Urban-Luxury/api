import { connect, disconnect, model } from 'mongoose';
import { UserSchema } from '../database/schemas/user.schema';
import { DB_TABLES } from '../shared/constants';
import config from '../shared/config';

async function main() {
  await connect(config().database.url);
  const users = model(DB_TABLES.USERS, UserSchema);
  const result = await users.updateMany(
    { isDriver: true, isVerified: { $exists: false } },
    { $set: { isVerified: false } },
  );
  process.stdout.write(
    `Backfilled ${result.modifiedCount} driver verification records.\n`,
  );
  await disconnect();
}

main().catch(async (error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
  await disconnect();
  process.exitCode = 1;
});
