import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BalanceSchema } from '../authentication/balance.schema';
import { DB_TABLES } from '../shared/constants';
import { DatabaseService } from './database.service';
import { ActivityLedgerService } from './activity-ledger.service';
import { ActivitySchema } from './schemas/activities.schema';
import { AuthTokenSchema } from './schemas/auth-tokens.schema';
import { CardSchema } from './schemas/card.schema';
import { CarBrandSchema } from './schemas/car-brands.schema';
import { DriverEarningSchema } from './schemas/driver-earnings.schema';
import { MessageSchema } from './schemas/messages.schema';
import { RentalSchema } from './schemas/rentals.schema';
import { RideSchema } from './schemas/rides.schema';
import { TripSchema } from './schemas/trips.schema';
import { UserSchema } from './schemas/user.schema';

@Global()
@Module({
  imports: [
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
      { name: DB_TABLES.ACTIVITIES, schema: ActivitySchema },
    ]),
  ],
  providers: [DatabaseService, ActivityLedgerService],
  exports: [DatabaseService, ActivityLedgerService],
})
export class DatabaseModule {}
