import { connect, connection, disconnect } from 'mongoose';
import {
  PLAY_REVIEW_EMAILS,
  PlayReviewAccountKind,
} from '../authentication/play-review-accounts';
import config from '../shared/config';
import { DB_TABLES } from '../shared/constants';
import { classifyUserRole } from './user-role-classifier';

type AuditUser = {
  _id: unknown;
  avatarSource?: string;
  companyName?: string;
  createdAt?: Date;
  email?: string;
  isDriver?: boolean;
  isVerified?: boolean;
  license?: string;
  licenseExpiry?: Date;
  licenseNumber?: string;
  oAuthProvider?: string;
  pushDevices?: Array<{ app?: string }>;
  referredBy?: unknown;
  registrationCode?: string;
  serviceLocation?: unknown;
  vehiclesInFleet?: string;
};

const hasText = (value?: string) => Boolean(value?.trim());
const asIds = (values: unknown[]) => new Set(values.map(String));

const demoRoleByEmail = new Map<string, 'driver' | 'rider'>(
  (Object.entries(PLAY_REVIEW_EMAILS) as [PlayReviewAccountKind, string][]).map(
    ([kind, email]) => [
      email,
      kind === 'driver' || kind === 'driverDeletion' ? 'driver' : 'rider',
    ],
  ),
);

async function main() {
  const databaseUrl = config().database.url;
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is required. Set it in api/.env or in the command environment.',
    );
  }

  const confirmed = process.argv.includes('--confirm');
  await connect(databaseUrl);

  const usersCollection = connection.collection(DB_TABLES.USERS);
  const ridesCollection = connection.collection(DB_TABLES.RIDES);
  const tripsCollection = connection.collection(DB_TABLES.TRIPS);
  const rentalsCollection = connection.collection(DB_TABLES.RENTALS);
  const referralsCollection = connection.collection(DB_TABLES.REFERRALS);
  const active = { deleted: { $ne: true } };

  const [
    rideDrivers,
    tripDrivers,
    rentalDrivers,
    referralInviters,
    referralInvitees,
    tripRiders,
    rentalRiders,
    users,
  ] = await Promise.all([
    ridesCollection.distinct('driver', active),
    tripsCollection.distinct('driver', active),
    rentalsCollection.distinct('driver', active),
    referralsCollection.distinct('inviter', active),
    referralsCollection.distinct('invitee', active),
    tripsCollection.distinct('user', active),
    rentalsCollection.distinct('user', active),
    usersCollection
      .find({ ...active, isAppAdmin: { $ne: true } })
      .project({
        avatarSource: 1,
        companyName: 1,
        createdAt: 1,
        email: 1,
        isDriver: 1,
        isVerified: 1,
        license: 1,
        licenseExpiry: 1,
        licenseNumber: 1,
        oAuthProvider: 1,
        pushDevices: 1,
        referredBy: 1,
        registrationCode: 1,
        serviceLocation: 1,
        vehiclesInFleet: 1,
      })
      .toArray() as Promise<AuditUser[]>,
  ]);

  const driverActivity = asIds([
    ...rideDrivers,
    ...tripDrivers,
    ...rentalDrivers,
    ...referralInviters,
    ...referralInvitees,
  ]);
  const riderActivity = asIds([...tripRiders, ...rentalRiders]);
  const changes: Array<{
    id: unknown;
    role: 'driver' | 'rider';
    setVerificationPending: boolean;
  }> = [];
  const ambiguous: AuditUser[] = [];
  const counts = { driver: 0, rider: 0, ambiguous: 0, unchanged: 0 };

  users.forEach((user) => {
    const id = String(user._id);
    const email = user.email?.trim().toLowerCase();
    const demoRole = email ? demoRoleByEmail.get(email) : undefined;
    const hasDriverProfile = Boolean(
      user.serviceLocation ||
        user.license ||
        user.licenseExpiry ||
        user.referredBy ||
        user.avatarSource ||
        hasText(user.licenseNumber) ||
        hasText(user.vehiclesInFleet) ||
        hasText(user.companyName) ||
        hasText(user.registrationCode),
    );
    const classification = classifyUserRole({
      currentIsDriver: user.isDriver,
      demoRole,
      hasDriverApp: Boolean(
        user.pushDevices?.some((device) => device.app === 'driver'),
      ),
      hasDriverActivity: driverActivity.has(id),
      hasDriverProfile,
      hasOAuthIdentity: Boolean(user.oAuthProvider),
      hasRiderApp: Boolean(
        user.pushDevices?.some((device) => device.app === 'rider'),
      ),
      hasRiderActivity: riderActivity.has(id),
    });
    counts[classification] += 1;

    if (classification === 'ambiguous') {
      ambiguous.push(user);
    } else if (
      (classification === 'driver' && user.isDriver !== true) ||
      (classification === 'rider' && user.isDriver !== false)
    ) {
      changes.push({
        id: user._id,
        role: classification,
        setVerificationPending:
          classification === 'driver' && user.isVerified === undefined,
      });
    }
  });

  process.stdout.write(
    `${confirmed ? 'CONFIRMED REPAIR' : 'DRY RUN'}\n` +
      `Scanned: ${users.length}\n` +
      `Classified drivers: ${counts.driver}\n` +
      `Classified riders: ${counts.rider}\n` +
      `Unchanged/no evidence: ${counts.unchanged}\n` +
      `Ambiguous: ${counts.ambiguous}\n` +
      `Promote to driver: ${
        changes.filter(({ role }) => role === 'driver').length
      }\n` +
      `Promoted drivers set to pending: ${
        changes.filter(({ setVerificationPending }) => setVerificationPending)
          .length
      }\n` +
      `Demote to rider: ${
        changes.filter(({ role }) => role === 'rider').length
      }\n` +
      `Total role corrections: ${changes.length}\n`,
  );

  if (ambiguous.length) {
    process.stdout.write('Ambiguous sample (manual review required):\n');
    ambiguous.slice(0, 50).forEach((user) => {
      process.stdout.write(
        `- ${String(user._id)} | ${user.email || 'no email'} | ${
          user.createdAt?.toISOString?.() || 'unknown date'
        } | OAuth: ${user.oAuthProvider || 'none'} | apps: ${
          user.pushDevices
            ?.map(({ app }) => app)
            .filter(Boolean)
            .join(',') || 'none'
        }\n`,
      );
    });
    if (ambiguous.length > 50) {
      process.stdout.write(`...and ${ambiguous.length - 50} more.\n`);
    }
  }

  if (!confirmed) {
    process.stdout.write(
      'No records changed. Review this output, then rerun with --confirm.\n',
    );
    return;
  }

  if (changes.length) {
    await usersCollection.bulkWrite(
      changes.map(({ id, role, setVerificationPending }) => ({
        updateOne: {
          filter: { _id: id },
          update:
            role === 'driver'
              ? {
                  $set: {
                    isDriver: true,
                    ...(setVerificationPending ? { isVerified: false } : {}),
                  },
                }
              : {
                  $set: { isDriver: false, isVerified: false },
                  $unset: { inviteCode: 1 },
                },
        },
      })),
    );
  }

  process.stdout.write(`Applied ${changes.length} role corrections.\n`);
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnect();
  });
