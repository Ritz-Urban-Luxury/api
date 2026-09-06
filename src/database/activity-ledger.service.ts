import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { ActivityType } from '../database/schemas/activities.schema';
import { DriverLedgerType } from '../database/schemas/driver-ledger.schema';
import { PaymentMethod } from '../database/schemas/trips.schema';
import { Configuration } from '../shared/config';

@Injectable()
export class ActivityLedgerService {
  private readonly logger = new Logger(ActivityLedgerService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService<Configuration>,
  ) {}

  commissionRate() {
    const rate = this.config.get('driverCommissionRate', { infer: true });
    if (!Number.isFinite(rate) || rate < 0 || rate >= 1) {
      return 0.2;
    }
    return rate as number;
  }

  splitFare(gross: number) {
    const rate = this.commissionRate();
    const commissionAmount = Math.round(gross * rate * 100) / 100;
    const netAmount = Math.round((gross - commissionAmount) * 100) / 100;
    return { grossAmount: gross, commissionAmount, netAmount };
  }

  async recordActivity(payload: {
    type: ActivityType;
    title: string;
    meta?: string;
    amount?: number;
    user?: string;
    trip?: string;
  }) {
    try {
      await this.db.activities.create(payload);
    } catch (error) {
      this.logger.warn(
        `failed to record activity ${payload.type}: ${
          (error as Error)?.message || error
        }`,
      );
    }
  }

  async recordDriverEarning(payload: {
    driver: string;
    trip?: string;
    rental?: string;
    amount: number;
    paymentMethod?: PaymentMethod | string;
  }) {
    if (!Number.isFinite(payload.amount) || payload.amount <= 0) {
      return;
    }

    if (!payload.trip && !payload.rental) {
      this.logger.warn('recordDriverEarning called without trip or rental');
      return;
    }

    const { grossAmount, commissionAmount, netAmount } = this.splitFare(
      payload.amount,
    );

    const filter = payload.rental
      ? { rental: payload.rental }
      : { trip: payload.trip };

    try {
      await this.db.driverEarnings.updateOne(
        filter,
        {
          $setOnInsert: {
            driver: payload.driver,
            ...(payload.trip ? { trip: payload.trip } : {}),
            ...(payload.rental ? { rental: payload.rental } : {}),
            amount: netAmount,
            grossAmount,
            commissionAmount,
            paymentMethod: payload.paymentMethod,
            earnedAt: new Date(),
          },
        },
        { upsert: true },
      );
    } catch (error) {
      this.logger.warn(
        `failed to record driver earning for ${
          payload.rental ? `rental ${payload.rental}` : `trip ${payload.trip}`
        }: ${(error as Error)?.message || error}`,
      );
    }

    if (
      payload.paymentMethod === PaymentMethod.Cash &&
      commissionAmount > 0 &&
      payload.trip
    ) {
      await this.recordCommissionOwed({
        driver: payload.driver,
        trip: payload.trip,
        amount: commissionAmount,
      });
    }
  }

  async recordCommissionOwed(payload: {
    driver: string;
    trip: string;
    amount: number;
  }) {
    if (!Number.isFinite(payload.amount) || payload.amount <= 0) {
      return;
    }

    try {
      await this.db.driverLedgerEntries.updateOne(
        { trip: payload.trip, type: DriverLedgerType.CommissionOwed },
        {
          $setOnInsert: {
            driver: payload.driver,
            trip: payload.trip,
            type: DriverLedgerType.CommissionOwed,
            amount: payload.amount,
            earnedAt: new Date(),
          },
        },
        { upsert: true },
      );
    } catch (error) {
      this.logger.warn(
        `failed to record commission owed for trip ${payload.trip}: ${
          (error as Error)?.message || error
        }`,
      );
    }
  }

  paymentActivityTitle(method?: PaymentMethod, succeeded = true) {
    if (!succeeded) {
      return 'Payment failed';
    }
    if (method === PaymentMethod.Card) {
      return 'Credit card Payment';
    }
    if (method === PaymentMethod.RULBalance) {
      return 'RUL balance Payment';
    }
    if (method === PaymentMethod.Cash) {
      return 'Cash Payment';
    }
    return 'Payment received';
  }

  formatAmountMeta(amount?: number) {
    if (!Number.isFinite(amount)) {
      return undefined;
    }
    return `Total ₦${Number(amount).toLocaleString()}`;
  }
}
