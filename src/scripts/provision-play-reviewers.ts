import { hash } from 'bcryptjs';
import * as Crypto from 'crypto';
import { connect, connection, disconnect } from 'mongoose';
import {
  getPlayReviewAccounts,
  PLAY_REVIEW_EMAILS,
} from '../authentication/play-review-accounts';
import {
  RideApprovalStatus,
  RideSchema,
  RideStatus,
  RideType,
} from '../database/schemas/rides.schema';
import { UserSchema } from '../database/schemas/user.schema';
import config from '../shared/config';
import { DB_TABLES } from '../shared/constants';

const SYNTHETIC_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

async function provisionPlayReviewers() {
  if (!process.argv.includes('--confirm')) {
    throw new Error(
      'Provisioning changes a database. Re-run with: npm run provision:play-reviewers -- --confirm',
    );
  }

  const accounts = getPlayReviewAccounts();
  if (accounts.length !== 2) {
    throw new Error(
      'Configure both Play reviewer accounts before provisioning',
    );
  }

  const databaseUrl = config().database.url;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  await connect(databaseUrl);
  const UserModel = connection.model(DB_TABLES.USERS, UserSchema);
  const RideModel = connection.model(DB_TABLES.RIDES, RideSchema);
  const password = await hash(Crypto.randomBytes(32).toString('hex'), 8);

  const rider = await UserModel.findOneAndUpdate(
    { email: PLAY_REVIEW_EMAILS.rider },
    {
      $set: {
        billingType: 'individual',
        deleted: false,
        email: PLAY_REVIEW_EMAILS.rider,
        firstName: 'Play',
        isAppAdmin: false,
        isDriver: false,
        isVerified: false,
        lastName: 'Rider Reviewer',
        'preferences.playReview': true,
        'preferences.syntheticDataOnly': true,
      },
      $setOnInsert: { password },
      $unset: {
        deletedAt: 1,
        deletionRequestedAt: 1,
        vehiclesInFleet: 1,
      },
    },
    { new: true, upsert: true },
  );

  const driver = await UserModel.findOneAndUpdate(
    { email: PLAY_REVIEW_EMAILS.driver },
    {
      $set: {
        accountNumber: '0000000000',
        address: 'Synthetic Google Play review account, Abuja',
        avatar: SYNTHETIC_IMAGE,
        bank: 'Review Bank',
        bankHolderName: 'Play Driver Reviewer',
        billingType: 'individual',
        city: 'Abuja',
        deleted: false,
        email: PLAY_REVIEW_EMAILS.driver,
        firstName: 'Play',
        isAppAdmin: false,
        isDriver: true,
        isVerified: true,
        languages: ['English'],
        lastName: 'Driver Reviewer',
        license: SYNTHETIC_IMAGE,
        licenseExpiry: new Date('2035-12-31T00:00:00.000Z'),
        licenseNumber: 'PLAY-REVIEW-0001',
        'preferences.playReview': true,
        'preferences.syntheticDataOnly': true,
      },
      $setOnInsert: { password },
      $unset: {
        deletedAt: 1,
        deletionRequestedAt: 1,
        vehiclesInFleet: 1,
      },
    },
    { new: true, upsert: true },
  );

  const vehicle = await RideModel.findOneAndUpdate(
    { driver: driver.id, registration: 'PLAY-REVIEW' },
    {
      $set: {
        approvalStatus: RideApprovalStatus.Approved,
        brand: 'Toyota',
        cautionDeposit: 0,
        color: 'Black',
        deleted: false,
        driver: driver.id,
        hourlyRate: 0,
        images: [SYNTHETIC_IMAGE],
        insuranceFee: 0,
        model: 'Camry',
        registration: 'PLAY-REVIEW',
        specs: { seats: 4, synthetic: true, year: '2024' },
        status: RideStatus.Offline,
        type: RideType.Classic,
      },
      $unset: { approvalReason: 1, location: 1 },
    },
    { new: true, upsert: true },
  );

  // Do not print either reusable OTP. Deployment logs are not a secret store.
  // eslint-disable-next-line no-console
  console.log(
    `Provisioned ${rider.email}, ${driver.email}, and synthetic vehicle ${vehicle.registration}`,
  );
}

provisionPlayReviewers()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnect();
  });
