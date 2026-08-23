import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
  ActivityType,
} from '../database/schemas/activities.schema';
import { PaymentMethod } from '../database/schemas/trips.schema';

@Injectable()
export class ActivityLedgerService {
  private readonly logger = new Logger(ActivityLedgerService.name);

  constructor(private readonly db: DatabaseService) {}

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
    trip: string;
    amount: number;
  }) {
    if (!Number.isFinite(payload.amount) || payload.amount <= 0) {
      return;
    }

    try {
      await this.db.driverEarnings.updateOne(
        { trip: payload.trip },
        {
          $setOnInsert: {
            driver: payload.driver,
            trip: payload.trip,
            amount: payload.amount,
            earnedAt: new Date(),
          },
        },
        { upsert: true },
      );
    } catch (error) {
      this.logger.warn(
        `failed to record driver earning for trip ${payload.trip}: ${
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
