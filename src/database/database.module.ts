import { Global, Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BalanceSchema } from '../authentication/balance.schema';
import { PaymentModule } from '../payments/payment.module';
import { DB_TABLES } from '../shared/constants';
import { DatabaseService } from './database.service';
import { ActivityLedgerService } from './activity-ledger.service';
import { ReferralService } from './referral.service';
import { ActivitySchema } from './schemas/activities.schema';
import { AuthTokenSchema } from './schemas/auth-tokens.schema';
import { CardSchema } from './schemas/card.schema';
import { CarBrandSchema } from './schemas/car-brands.schema';
import { DriverEarningSchema } from './schemas/driver-earnings.schema';
import { DriverLedgerEntrySchema } from './schemas/driver-ledger.schema';
import { DriverOnlineSessionSchema } from './schemas/driver-online-session.schema';
import { DriverRideOfferSchema } from './schemas/driver-ride-offer.schema';
import { MessageSchema } from './schemas/messages.schema';
import { ReferralSchema } from './schemas/referrals.schema';
import { RentalSchema } from './schemas/rentals.schema';
import { RideSchema } from './schemas/rides.schema';
import { TripSchema } from './schemas/trips.schema';
import { UserSchema } from './schemas/user.schema';
import { WalletTransactionSchema } from './schemas/wallet-transaction.schema';
import { BankAccountSchema } from './schemas/bank-account.schema';
import { PayoutRequestSchema } from './schemas/payout-request.schema';
import { FinancialSettingsSchema } from './schemas/financial-settings.schema';
import { DriverFinancialStateSchema } from './schemas/driver-financial-state.schema';
import { PushCampaignSchema } from './schemas/push-campaign.schema';
import { UserBlockSchema } from './schemas/user-block.schema';
import { UserReportSchema } from './schemas/user-report.schema';

@Global()
@Module({
  imports: [
    forwardRef(() => PaymentModule),
    MongooseModule.forFeature([
      { name: DB_TABLES.AUTH_TOKENS, schema: AuthTokenSchema },
      { name: DB_TABLES.USERS, schema: UserSchema },
      { name: DB_TABLES.RIDES, schema: RideSchema },
      { name: DB_TABLES.TRIPS, schema: TripSchema },
      { name: DB_TABLES.BALANCES, schema: BalanceSchema },
      { name: DB_TABLES.MESSAGES, schema: MessageSchema },
      { name: DB_TABLES.CARDS, schema: CardSchema },
      { name: DB_TABLES.RENTALS, schema: RentalSchema },
      { name: DB_TABLES.CAR_BRANDS, schema: CarBrandSchema },
      { name: DB_TABLES.DRIVER_EARNINGS, schema: DriverEarningSchema },
      {
        name: DB_TABLES.DRIVER_LEDGER_ENTRIES,
        schema: DriverLedgerEntrySchema,
      },
      { name: DB_TABLES.DRIVER_RIDE_OFFERS, schema: DriverRideOfferSchema },
      {
        name: DB_TABLES.DRIVER_ONLINE_SESSIONS,
        schema: DriverOnlineSessionSchema,
      },
      { name: DB_TABLES.ACTIVITIES, schema: ActivitySchema },
      { name: DB_TABLES.REFERRALS, schema: ReferralSchema },
      { name: DB_TABLES.WALLET_TRANSACTIONS, schema: WalletTransactionSchema },
      { name: DB_TABLES.BANK_ACCOUNTS, schema: BankAccountSchema },
      { name: DB_TABLES.PAYOUT_REQUESTS, schema: PayoutRequestSchema },
      { name: DB_TABLES.FINANCIAL_SETTINGS, schema: FinancialSettingsSchema },
      {
        name: DB_TABLES.DRIVER_FINANCIAL_STATES,
        schema: DriverFinancialStateSchema,
      },
      { name: DB_TABLES.PUSH_CAMPAIGNS, schema: PushCampaignSchema },
      { name: DB_TABLES.USER_BLOCKS, schema: UserBlockSchema },
      { name: DB_TABLES.USER_REPORTS, schema: UserReportSchema },
    ]),
  ],
  providers: [DatabaseService, ActivityLedgerService, ReferralService],
  exports: [DatabaseService, ActivityLedgerService, ReferralService],
})
export class DatabaseModule {}
