import { connect, disconnect, model } from 'mongoose';
import {
  RideApprovalStatus,
  RideSchema,
  RideType,
  VehicleCategory,
} from '../database/schemas/rides.schema';
import { DB_TABLES } from '../shared/constants';
import config from '../shared/config';

async function main() {
  const databaseUrl = config().database.url;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  await connect(databaseUrl);
  const rides = model(DB_TABLES.RIDES, RideSchema);

  const [classicClaims, luxuryClaims, approvedClassic, approvedLuxury, hires] =
    await Promise.all([
      rides.updateMany(
        { type: RideType.Classic, claimedCategory: { $exists: false } },
        { $set: { claimedCategory: VehicleCategory.Classic } },
      ),
      rides.updateMany(
        { type: RideType.Luxury, claimedCategory: { $exists: false } },
        { $set: { claimedCategory: VehicleCategory.Luxury } },
      ),
      rides.updateMany(
        {
          type: RideType.Classic,
          approvalStatus: RideApprovalStatus.Approved,
          vehicleCategory: { $exists: false },
        },
        { $set: { vehicleCategory: VehicleCategory.Classic } },
      ),
      rides.updateMany(
        {
          type: RideType.Luxury,
          approvalStatus: RideApprovalStatus.Approved,
          vehicleCategory: { $exists: false },
        },
        { $set: { vehicleCategory: VehicleCategory.Luxury } },
      ),
      rides.updateMany(
        { type: RideType.Hire, vehicleCategory: { $exists: false } },
        {
          $set: {
            claimedCategory: VehicleCategory.Classic,
            vehicleCategory: VehicleCategory.Classic,
          },
        },
      ),
    ]);

  process.stdout.write(
    `Vehicle category backfill complete: ${JSON.stringify({
      classicClaims: classicClaims.modifiedCount,
      luxuryClaims: luxuryClaims.modifiedCount,
      approvedClassic: approvedClassic.modifiedCount,
      approvedLuxury: approvedLuxury.modifiedCount,
      hiresDefaultedToClassic: hires.modifiedCount,
    })}\n`,
  );
  await disconnect();
}

main().catch(async (error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
  await disconnect();
  process.exitCode = 1;
});
