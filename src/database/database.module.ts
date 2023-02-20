import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BalanceSchema } from 'src/authentication/balance.schema';
import { DB_TABLES } from 'src/shared/constants';
import { DatabaseService } from './database.service';
import { AuthTokenSchema } from './schemas/auth-tokens.schema';
import { CardSchema } from './schemas/card.schema';
import { MessageSchema } from './schemas/messages.schema';
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
    ]),
  ],
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
