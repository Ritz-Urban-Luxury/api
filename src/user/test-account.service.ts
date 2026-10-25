import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClientSession, FilterQuery } from 'mongoose';
import { getPlayReviewAccounts } from '../authentication/play-review-accounts';
import { DatabaseService } from '../database/database.service';
import {
  UserDocument,
  TestAccountPurpose,
} from '../database/schemas/user.schema';
import { FileService } from '../file/file.service';
import { ActivePayoutRequestStatuses } from '../database/schemas/payout-request.schema';
import { RideStatus, RideType } from '../database/schemas/rides.schema';
import { AdminAuditAction } from '../database/schemas/admin-audit-log.schema';

type PurgeCounts = Record<string, number>;

const ids = (documents: Array<{ id?: string; _id?: unknown }>) =>
  documents.map((document) => String(document.id || document._id));

@Injectable()
export class TestAccountService {
  constructor(
    private readonly db: DatabaseService,
    private readonly files: FileService,
  ) {}

  private async getUserOrFail(userId: string) {
    const user = await this.db.users.findOne({
      _id: userId,
      deleted: { $ne: true },
    });
    if (!user) throw new NotFoundException('user not found');
    return user;
  }

  private relationshipQueries(userId: string) {
    return {
      trips: {
        $or: [{ user: userId }, { driver: userId }, { cancelledBy: userId }],
      },
      rentals: {
        $or: [{ user: userId }, { driver: userId }, { cancelledBy: userId }],
      },
      rides: { driver: userId },
    };
  }

  async preview(userId: string, permanent = false) {
    const user = await this.getUserOrFail(userId);
    const relation = this.relationshipQueries(userId);
    const [trips, rentals, rides, balance, walletTransactions, activePayouts] =
      await Promise.all([
        this.db.trips.find(relation.trips).select('_id user driver').lean(),
        this.db.rentals.find(relation.rentals).select('_id user driver').lean(),
        this.db.rides.find(relation.rides).select('_id images').lean(),
        this.db.balances.findOne({ user: userId }).lean(),
        this.db.walletTransactions
          .find({ user: userId })
          .select('provider providerMode providerReference amountKobo')
          .lean(),
        this.db.payoutRequests.countDocuments({
          user: userId,
          status: { $in: ActivePayoutRequestStatuses },
        }),
      ]);
    const tripIds = ids(trips);
    const rentalIds = ids(rentals);
    const rideIds = ids(rides);
    const linkedIds = new Set<string>();
    [...trips, ...rentals].forEach((record) => {
      [record.user, record.driver].forEach((value) => {
        const id = value ? String(value) : '';
        if (id && id !== userId) linkedIds.add(id);
      });
    });
    const linkedNonTestUsers = linkedIds.size
      ? await this.db.users
          .find({
            _id: { $in: [...linkedIds] },
            isTestAccount: { $ne: true },
            deleted: { $ne: true },
          })
          .select('_id email phoneNumber')
          .lean()
      : [];

    const messageQuery: FilterQuery<unknown> = {
      $or: [
        { sender: userId },
        ...(tripIds.length ? [{ trip: { $in: tripIds } }] : []),
      ],
    };
    const auditReferenceQueries = [
      this.db.newsArticles.countDocuments({
        $or: [{ createdBy: userId }, { updatedBy: userId }],
      }),
      this.db.pushCampaigns.countDocuments({ createdBy: userId }),
      this.db.pricingChanges.countDocuments({ changedBy: userId }),
      this.db.pricingSettings.countDocuments({ updatedBy: userId }),
      this.db.pricingZones.countDocuments({ updatedBy: userId }),
      this.db.financialSettings.countDocuments({ updatedBy: userId }),
      this.db.payoutRequests.countDocuments({
        reviewedBy: userId,
        user: { $ne: userId },
      }),
    ];

    const countEntries = await Promise.all(
      (
        [
          ['trips', Promise.resolve(trips.length)],
          ['rentals', Promise.resolve(rentals.length)],
          ['rides', Promise.resolve(rides.length)],
          ['messages', this.db.messages.countDocuments(messageQuery)],
          [
            'driverEarnings',
            this.db.driverEarnings.countDocuments({
              $or: [
                { driver: userId },
                ...(tripIds.length ? [{ trip: { $in: tripIds } }] : []),
                ...(rentalIds.length ? [{ rental: { $in: rentalIds } }] : []),
              ],
            }),
          ],
          [
            'driverLedgerEntries',
            this.db.driverLedgerEntries.countDocuments({
              $or: [
                { driver: userId },
                ...(tripIds.length ? [{ trip: { $in: tripIds } }] : []),
              ],
            }),
          ],
          ['walletTransactions', Promise.resolve(walletTransactions.length)],
          ['balances', this.db.balances.countDocuments({ user: userId })],
          ['cards', this.db.cards.countDocuments({ user: userId })],
          [
            'bankAccounts',
            this.db.bankAccounts.countDocuments({ user: userId }),
          ],
          [
            'payoutRequests',
            this.db.payoutRequests.countDocuments({ user: userId }),
          ],
          ['activities', this.db.activities.countDocuments({ user: userId })],
          [
            'referrals',
            this.db.referrals.countDocuments({
              $or: [{ inviter: userId }, { invitee: userId }],
            }),
          ],
          [
            'userReports',
            this.db.userReports.countDocuments({
              $or: [
                { reporter: userId },
                { reportedUser: userId },
                ...(tripIds.length ? [{ trip: { $in: tripIds } }] : []),
              ],
            }),
          ],
          [
            'driverRideOffers',
            this.db.driverRideOffers.countDocuments({
              $or: [
                { driver: userId },
                { user: userId },
                ...(tripIds.length ? [{ trip: { $in: tripIds } }] : []),
              ],
            }),
          ],
          [
            'driverOnlineSessions',
            this.db.driverOnlineSessions.countDocuments({
              $or: [
                { driver: userId },
                ...(rideIds.length ? [{ ride: { $in: rideIds } }] : []),
              ],
            }),
          ],
          [
            'userBlocks',
            this.db.userBlocks.countDocuments({
              $or: [{ blocker: userId }, { blocked: userId }],
            }),
          ],
          ['newsReads', this.db.newsReads.countDocuments({ user: userId })],
          [
            'driverFinancialStates',
            this.db.driverFinancialStates.countDocuments({ driver: userId }),
          ],
        ] as Array<[string, Promise<number>]>
      ).map(async ([name, count]) => [name, await count] as const),
    );
    const counts = Object.fromEntries(
      countEntries.map(([name, count]) => [name, count]),
    ) as PurgeCounts;
    const auditReferences = (await Promise.all(auditReferenceQueries)).reduce(
      (total, count) => total + count,
      0,
    );
    const reviewAccount = getPlayReviewAccounts().some(
      (account) => account.email === user.email?.toLowerCase().trim(),
    );
    const blockers: string[] = [];
    const warnings: string[] = [];
    if (!permanent && !user.isTestAccount)
      blockers.push('Account is not marked as a test account');
    if (user.isAppAdmin)
      blockers.push('Administrator accounts cannot be purged');
    if (
      reviewAccount ||
      user.testAccountPurpose === TestAccountPurpose.AppReview
    ) {
      blockers.push('App-review accounts must be reset, not purged');
    }
    if (activePayouts > 0)
      blockers.push('Account has an active payout request');
    if (
      permanent &&
      [
        balance?.amount,
        balance?.cashAmount,
        balance?.rideCreditAmount,
        balance?.reservedAmount,
      ].some((value) => Number(value || 0) !== 0)
    ) {
      blockers.push('Account wallet balances must be settled before deletion');
    }
    if (linkedNonTestUsers.length > 0) {
      blockers.push('Account has trips or rentals involving non-test users');
    }
    if (auditReferences > 0) {
      blockers.push('Account is referenced by administrative audit records');
    }
    const legacyPaystackTransactions = walletTransactions.filter(
      (entry) => entry.provider === 'Paystack' && !entry.providerMode,
    ).length;
    if (legacyPaystackTransactions > 0) {
      warnings.push(
        `${legacyPaystackTransactions} legacy Paystack transaction(s) have no test/live marker`,
      );
    }

    return {
      user: {
        id: String(user.id),
        email: user.email,
        phoneNumber: user.phoneNumber,
        isTestAccount: user.isTestAccount === true,
        testAccountPurpose: user.testAccountPurpose,
      },
      canPurge: blockers.length === 0,
      blockers,
      warnings,
      counts,
      wallet: {
        amount: Number(balance?.amount || 0),
        cashAmount: Number(balance?.cashAmount || 0),
        rideCreditAmount: Number(balance?.rideCreditAmount || 0),
        reservedAmount: Number(balance?.reservedAmount || 0),
        legacyPaystackTransactions,
      },
      linkedNonTestUsers: linkedNonTestUsers.map((linked) => ({
        id: String(linked._id),
        email: linked.email,
        phoneNumber: linked.phoneNumber,
      })),
      assets: [
        user.avatar,
        user.license,
        ...rides.flatMap((ride) => ride.images || []),
      ].filter(Boolean),
    };
  }

  async purge(
    admin: UserDocument,
    userId: string,
    payload: { confirmation: string; reason: string },
    permanent = false,
  ) {
    const preview = await this.preview(userId, permanent);
    const expected = `${permanent ? 'DELETE' : 'PURGE'} ${
      preview.user.email || preview.user.phoneNumber || preview.user.id
    }`;
    if (payload.confirmation !== expected) {
      throw new BadRequestException(
        `Confirmation must exactly match: ${expected}`,
      );
    }
    if (!preview.canPurge) {
      throw new ConflictException(preview.blockers.join('; '));
    }

    const relation = this.relationshipQueries(userId);
    const session = await this.db.users.db.startSession();
    try {
      await session.withTransaction(async () => {
        const [trips, rentals, rides] = await Promise.all([
          this.db.trips
            .find(relation.trips)
            .select('_id')
            .session(session)
            .lean(),
          this.db.rentals
            .find(relation.rentals)
            .select('_id')
            .session(session)
            .lean(),
          this.db.rides
            .find(relation.rides)
            .select('_id')
            .session(session)
            .lean(),
        ]);
        const tripIds = ids(trips);
        const rentalIds = ids(rentals);
        const rideIds = ids(rides);
        const messages = await this.db.messages
          .find({
            $or: [
              { sender: userId },
              ...(tripIds.length ? [{ trip: { $in: tripIds } }] : []),
            ],
          })
          .select('_id')
          .session(session)
          .lean();
        const messageIds = ids(messages);
        const options = { session };

        await Promise.all([
          this.db.userReports.deleteMany(
            {
              $or: [
                { reporter: userId },
                { reportedUser: userId },
                ...(tripIds.length ? [{ trip: { $in: tripIds } }] : []),
                ...(messageIds.length
                  ? [{ message: { $in: messageIds } }]
                  : []),
              ],
            },
            options,
          ),
          this.db.messages.deleteMany({ _id: { $in: messageIds } }, options),
          this.db.driverEarnings.deleteMany(
            {
              $or: [
                { driver: userId },
                ...(tripIds.length ? [{ trip: { $in: tripIds } }] : []),
                ...(rentalIds.length ? [{ rental: { $in: rentalIds } }] : []),
              ],
            },
            options,
          ),
          this.db.driverLedgerEntries.deleteMany(
            {
              $or: [
                { driver: userId },
                ...(tripIds.length ? [{ trip: { $in: tripIds } }] : []),
              ],
            },
            options,
          ),
          this.db.driverRideOffers.deleteMany(
            {
              $or: [
                { driver: userId },
                { user: userId },
                ...(tripIds.length ? [{ trip: { $in: tripIds } }] : []),
              ],
            },
            options,
          ),
          this.db.driverOnlineSessions.deleteMany(
            {
              $or: [
                { driver: userId },
                ...(rideIds.length ? [{ ride: { $in: rideIds } }] : []),
              ],
            },
            options,
          ),
          this.db.userBlocks.deleteMany(
            { $or: [{ blocker: userId }, { blocked: userId }] },
            options,
          ),
          this.db.activities.deleteMany(
            {
              $or: [
                { user: userId },
                ...(tripIds.length ? [{ trip: { $in: tripIds } }] : []),
              ],
            },
            options,
          ),
          this.db.referrals.deleteMany(
            { $or: [{ inviter: userId }, { invitee: userId }] },
            options,
          ),
          this.db.walletTransactions.deleteMany({ user: userId }, options),
          this.db.balances.deleteMany({ user: userId }, options),
          this.db.cards.deleteMany({ user: userId }, options),
          this.db.bankAccounts.deleteMany({ user: userId }, options),
          this.db.payoutRequests.deleteMany({ user: userId }, options),
          this.db.driverFinancialStates.deleteMany({ driver: userId }, options),
          this.db.newsReads.deleteMany({ user: userId }, options),
          this.db.authTokens.deleteMany(
            {
              $or: [
                { 'meta.user': userId },
                ...(preview.user.email
                  ? [{ 'meta.email': preview.user.email }]
                  : []),
                ...(preview.user.phoneNumber
                  ? [{ 'meta.phoneNumber': preview.user.phoneNumber }]
                  : []),
              ],
            },
            options,
          ),
          this.db.users.updateMany(
            { referredBy: userId },
            { $unset: { referredBy: 1 } },
            options,
          ),
        ]);

        await this.db.trips.deleteMany({ _id: { $in: tripIds } }, options);
        await this.db.rentals.deleteMany({ _id: { $in: rentalIds } }, options);
        await this.db.rides.deleteMany({ _id: { $in: rideIds } }, options);
        await this.db.users.deleteOne({ _id: userId }, options);
        await this.db.adminAuditLogs.create(
          [
            {
              action: permanent
                ? AdminAuditAction.UserPermanentlyDeleted
                : AdminAuditAction.TestAccountPurged,
              actor: admin.id,
              targetUserId: userId,
              targetIdentity:
                preview.user.email ||
                preview.user.phoneNumber ||
                preview.user.id,
              reason: payload.reason,
              meta: { counts: preview.counts },
            },
          ],
          options,
        );
      });
    } finally {
      await session.endSession();
    }

    const failedAssetDeletes = await this.files.deleteUrls(preview.assets);
    return {
      purged: true,
      userId,
      reason: payload.reason,
      performedBy: String(admin.id),
      counts: preview.counts,
      failedAssetDeletes,
    };
  }

  previewPermanent(userId: string) {
    return this.preview(userId, true);
  }

  purgePermanent(
    admin: UserDocument,
    userId: string,
    payload: { confirmation: string; reason: string },
  ) {
    if (String(admin.id) === userId) {
      throw new ConflictException(
        'Super administrators cannot delete themselves',
      );
    }
    return this.purge(admin, userId, payload, true);
  }

  async resetAppReviewData(admin: UserDocument) {
    const accounts = getPlayReviewAccounts();
    const emails = accounts.map((account) => account.email);
    const users = await this.db.users.find({ email: { $in: emails } });
    if (!users.length) {
      throw new NotFoundException(
        'No configured app-review accounts were found',
      );
    }
    const userIds = users.map((user) => String(user.id));
    const [trips, rentals, rides] = await Promise.all([
      this.db.trips.find({
        'meta.playReviewSynthetic': true,
        $or: [{ user: { $in: userIds } }, { driver: { $in: userIds } }],
      }),
      this.db.rentals.find({
        'meta.playReviewSynthetic': true,
        $or: [{ user: { $in: userIds } }, { driver: { $in: userIds } }],
      }),
      this.db.rides.find({
        driver: { $in: userIds },
        'specs.synthetic': true,
      }),
    ]);
    const tripIds = ids(trips);
    const rentalIds = ids(rentals);
    const rideIds = ids(rides);
    const session: ClientSession = await this.db.users.db.startSession();
    try {
      await session.withTransaction(async () => {
        const options = { session };
        await Promise.all([
          this.db.messages.deleteMany({ trip: { $in: tripIds } }, options),
          this.db.userReports.deleteMany({ trip: { $in: tripIds } }, options),
          this.db.activities.deleteMany({ trip: { $in: tripIds } }, options),
          this.db.driverEarnings.deleteMany(
            {
              $or: [{ trip: { $in: tripIds } }, { rental: { $in: rentalIds } }],
            },
            options,
          ),
          this.db.driverLedgerEntries.deleteMany(
            { trip: { $in: tripIds } },
            options,
          ),
          this.db.driverRideOffers.deleteMany(
            {
              $or: [
                { driver: { $in: userIds } },
                { user: { $in: userIds } },
                { trip: { $in: tripIds } },
              ],
            },
            options,
          ),
          this.db.driverOnlineSessions.deleteMany(
            {
              $or: [{ driver: { $in: userIds } }, { ride: { $in: rideIds } }],
            },
            options,
          ),
          this.db.userBlocks.deleteMany(
            {
              $or: [
                { blocker: { $in: userIds } },
                { blocked: { $in: userIds } },
              ],
            },
            options,
          ),
          this.db.walletTransactions.deleteMany(
            { user: { $in: userIds } },
            options,
          ),
          this.db.balances.deleteMany({ user: { $in: userIds } }, options),
          this.db.cards.deleteMany({ user: { $in: userIds } }, options),
          this.db.bankAccounts.deleteMany({ user: { $in: userIds } }, options),
          this.db.payoutRequests.deleteMany(
            { user: { $in: userIds } },
            options,
          ),
          this.db.driverFinancialStates.deleteMany(
            { driver: { $in: userIds } },
            options,
          ),
        ]);
        await this.db.trips.deleteMany({ _id: { $in: tripIds } }, options);
        await this.db.rentals.deleteMany({ _id: { $in: rentalIds } }, options);
        await this.db.rides.updateMany(
          { _id: { $in: rideIds } },
          {
            $set: { deleted: false, status: RideStatus.Online },
            $unset: { location: 1 },
          },
          options,
        );
        await this.db.rides.updateMany(
          { _id: { $in: rideIds }, type: { $ne: RideType.Hire } },
          { $set: { status: RideStatus.Offline } },
          options,
        );
        await this.db.users.updateMany(
          { _id: { $in: userIds } },
          {
            $set: {
              deleted: false,
              isTestAccount: true,
              testAccountPurpose: TestAccountPurpose.AppReview,
            },
            $unset: { deletedAt: 1, deletionRequestedAt: 1 },
          },
          options,
        );
        await this.db.adminAuditLogs.create(
          [
            {
              action: AdminAuditAction.AppReviewDataReset,
              actor: admin.id,
              reason: 'Reset App Review demo data',
              meta: {
                accounts: users.map((user) => user.email),
                removed: {
                  trips: tripIds.length,
                  rentals: rentalIds.length,
                },
              },
            },
          ],
          options,
        );
      });
    } finally {
      await session.endSession();
    }

    return {
      reset: true,
      performedBy: String(admin.id),
      accounts: users.map((user) => user.email),
      removed: { trips: tripIds.length, rentals: rentalIds.length },
    };
  }
}
