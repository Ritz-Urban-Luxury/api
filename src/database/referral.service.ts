import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { DatabaseService } from './database.service';
import {
  ReferralStatus,
} from './schemas/referrals.schema';
import { ActivityType } from './schemas/activities.schema';
import { UserDocument } from './schemas/user.schema';
import { PaymentService } from '../payments/payment.service';
import { Configuration } from '../shared/config';

@Injectable()
export class ReferralService {
  private readonly logger = new Logger(ReferralService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly paymentService: PaymentService,
    private readonly config: ConfigService<Configuration>,
  ) {}

  bonusAmount() {
    const amount = this.config.get('referralBonusAmount', { infer: true });
    if (!Number.isFinite(amount) || (amount as number) <= 0) {
      return 7500;
    }
    return Math.round(amount as number);
  }

  private generateCodeCandidate() {
    return `RUL${randomBytes(4).toString('hex').toUpperCase()}`;
  }

  private userIdOf(user: UserDocument | string) {
    if (typeof user === 'string') {
      return user;
    }
    return String(user.id || user._id);
  }

  /** Legacy accounts often have fleet/trip vehicles but never got `isDriver` set. */
  async isDriverAccount(user: UserDocument | string) {
    const existing =
      typeof user === 'string' ? await this.db.users.findById(user) : user;
    if (!existing || existing.deleted) {
      return false;
    }
    if (existing.isDriver) {
      return true;
    }
    const userId = this.userIdOf(existing);
    const hasVehicle = await this.db.rides.exists({
      driver: userId,
      deleted: { $ne: true },
    });
    return Boolean(hasVehicle);
  }

  async ensureInviteCode(user: UserDocument | string) {
    const userId = this.userIdOf(user);
    const existing =
      typeof user === 'string'
        ? await this.db.users.findById(userId)
        : user;

    if (!existing) {
      return null;
    }

    if (existing.inviteCode) {
      if (!existing.isDriver) {
        await this.db.users.updateOne(
          { _id: userId, isDriver: { $ne: true } },
          { $set: { isDriver: true } },
        );
      }
      return existing.inviteCode;
    }

    if (!(await this.isDriverAccount(existing))) {
      return null;
    }

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const inviteCode = this.generateCodeCandidate();
      try {
        const updated = await this.db.users.findOneAndUpdate(
          {
            _id: userId,
            $or: [
              { inviteCode: { $exists: false } },
              { inviteCode: null },
              { inviteCode: '' },
            ],
          },
          { $set: { inviteCode, isDriver: true } },
          { new: true },
        );
        if (updated?.inviteCode) {
          return updated.inviteCode;
        }
        const refreshed = await this.db.users.findById(userId);
        if (refreshed?.inviteCode) {
          return refreshed.inviteCode;
        }
      } catch {
        // unique collision — retry
      }
    }

    this.logger.warn(`failed to allocate invite code for user ${userId}`);
    return null;
  }

  async applyReferralCode(invitee: UserDocument, referralCode: string) {
    const code = referralCode.trim().toUpperCase();
    if (!code) {
      throw new BadRequestException('referral code is required');
    }

    if (invitee.referredBy) {
      throw new BadRequestException('referral code already applied');
    }

    const existingReferral = await this.db.referrals.findOne({
      invitee: invitee.id,
      deleted: { $ne: true },
    });
    if (existingReferral) {
      throw new BadRequestException('referral code already applied');
    }

    await this.ensureInviteCode(invitee);

    const inviter = await this.db.users.findOne({
      inviteCode: code,
      deleted: { $ne: true },
    });

    if (!inviter || !(await this.isDriverAccount(inviter))) {
      throw new BadRequestException('invalid referral code');
    }

    if (String(inviter.id) === String(invitee.id)) {
      throw new BadRequestException('you cannot use your own invite code');
    }

    await this.ensureInviteCode(inviter);

    const bonusAmount = this.bonusAmount();

    await this.db.users.updateOne(
      { _id: invitee.id, referredBy: { $exists: false } },
      { $set: { referredBy: inviter.id } },
    );

    const updatedInvitee = await this.db.users.findById(invitee.id);
    if (
      !updatedInvitee?.referredBy ||
      String(updatedInvitee.referredBy) !== String(inviter.id)
    ) {
      throw new BadRequestException('referral code already applied');
    }

    try {
      await this.db.referrals.create({
        inviter: inviter.id,
        invitee: invitee.id,
        houseRevenue: 0,
        bonusAmount,
        status: ReferralStatus.Pending,
      });
    } catch (error) {
      this.logger.warn(
        `failed to create referral for invitee ${invitee.id}: ${
          (error as Error)?.message || error
        }`,
      );
      throw new BadRequestException('referral code already applied');
    }

    return {
      inviterId: inviter.id,
      bonusAmount,
      status: ReferralStatus.Pending,
    };
  }

  async recordInviteeHouseRevenue(inviteeId: string, commissionAmount: number) {
    if (!Number.isFinite(commissionAmount) || commissionAmount <= 0) {
      return;
    }

    const referral = await this.db.referrals.findOneAndUpdate(
      {
        invitee: inviteeId,
        status: ReferralStatus.Pending,
        deleted: { $ne: true },
      },
      { $inc: { houseRevenue: Math.round(commissionAmount * 100) / 100 } },
      { new: true },
    );

    if (!referral) {
      return;
    }

    if (referral.houseRevenue < referral.bonusAmount) {
      return;
    }

    const claimed = await this.db.referrals.findOneAndUpdate(
      {
        _id: referral.id,
        status: ReferralStatus.Pending,
        deleted: { $ne: true },
      },
      {
        $set: {
          status: ReferralStatus.Paid,
          paidAt: new Date(),
        },
      },
      { new: true },
    );

    if (!claimed) {
      return;
    }

    try {
      const inviterId = String(
        (claimed.inviter as { id?: string })?.id || claimed.inviter,
      );
      const inviter = await this.db.users.findById(inviterId);
      if (!inviter) {
        this.logger.warn(
          `referral ${claimed.id} paid but inviter ${inviterId} missing`,
        );
        return;
      }

      await this.paymentService.creditUserRULBalance(
        inviter,
        claimed.bonusAmount,
      );

      await this.db.activities.create({
        type: ActivityType.ReferralBonusPaid,
        title: 'Referral bonus paid',
        meta: `Invitee ${inviteeId}`,
        amount: claimed.bonusAmount,
        user: inviter.id,
      });
    } catch (error) {
      this.logger.error(
        `failed to credit referral bonus for referral ${claimed.id}: ${
          (error as Error)?.message || error
        }`,
      );
      await this.db.referrals.updateOne(
        { _id: claimed.id },
        {
          $set: {
            status: ReferralStatus.Pending,
            paidAt: null,
          },
        },
      );
    }
  }

  async getInviteSummary(user: UserDocument) {
    const inviteCode = await this.ensureInviteCode(user);
    const bonusAmount = this.bonusAmount();
    const referrals = await this.db.referrals
      .find({
        inviter: user.id,
        deleted: { $ne: true },
      })
      .populate('invitee', 'firstName lastName email phoneNumber')
      .sort({ createdAt: -1 })
      .limit(50);

    return {
      inviteCode,
      bonusAmount,
      referrals: referrals.map((row) => {
        const invitee =
          row.invitee && typeof row.invitee === 'object'
            ? (row.invitee as UserDocument)
            : null;
        const name = invitee
          ? `${invitee.firstName || ''} ${invitee.lastName || ''}`.trim() ||
            invitee.email ||
            invitee.phoneNumber ||
            'Driver'
          : 'Driver';
        const progress = Math.min(
          1,
          row.bonusAmount > 0 ? row.houseRevenue / row.bonusAmount : 0,
        );
        return {
          id: row.id,
          inviteeName: name,
          houseRevenue: row.houseRevenue,
          bonusAmount: row.bonusAmount,
          status: row.status,
          progress,
          paidAt: row.paidAt || null,
          createdAt: row.createdAt,
        };
      }),
    };
  }
}
