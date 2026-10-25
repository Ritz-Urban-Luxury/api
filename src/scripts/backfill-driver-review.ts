import { connect, disconnect, model } from 'mongoose';
import {
  AdminRole,
  DriverReviewStatus,
  UserSchema,
} from '../database/schemas/user.schema';
import { DB_TABLES } from '../shared/constants';
import config from '../shared/config';

async function main() {
  const databaseUrl = config().database.url;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  await connect(databaseUrl);
  const users = model(DB_TABLES.USERS, UserSchema);

  const existingSuperAdmin = await users
    .findOne({ isAppAdmin: true, adminRole: AdminRole.SuperAdmin })
    .select('_id')
    .lean();
  const seededAdmin = existingSuperAdmin
    ? null
    : await users
        .findOne({ isAppAdmin: true })
        .sort({ createdAt: 1, _id: 1 })
        .select('_id email')
        .lean();
  const superAdmin = seededAdmin
    ? await users.updateOne(
        { _id: seededAdmin._id, isAppAdmin: true },
        { $set: { adminRole: AdminRole.SuperAdmin } },
      )
    : { modifiedCount: 0 };

  const [approvedDrivers, pendingDrivers, admins] = await Promise.all([
    users.updateMany(
      {
        isDriver: true,
        isVerified: true,
        driverReviewStatus: { $exists: false },
      },
      { $set: { driverReviewStatus: DriverReviewStatus.Approved } },
    ),
    users.updateMany(
      {
        isDriver: true,
        isVerified: { $ne: true },
        driverReviewStatus: { $exists: false },
      },
      { $set: { driverReviewStatus: DriverReviewStatus.Pending } },
    ),
    users.updateMany(
      { isAppAdmin: true, adminRole: { $exists: false } },
      { $set: { adminRole: AdminRole.Admin } },
    ),
  ]);

  process.stdout.write(
    `Driver review backfill complete: ${JSON.stringify({
      approvedDrivers: approvedDrivers.modifiedCount,
      pendingDrivers: pendingDrivers.modifiedCount,
      admins: admins.modifiedCount,
      superAdmins: superAdmin.modifiedCount,
      seededSuperAdmin: seededAdmin?.email,
    })}\n`,
  );
  await disconnect();
}

main().catch(async (error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
  await disconnect();
  process.exitCode = 1;
});
