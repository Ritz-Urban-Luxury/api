import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DB_TABLES } from 'src/shared/constants';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { BalanceSchema } from './schemas/balance.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DB_TABLES.BALANCES, schema: BalanceSchema },
    ]),
  ],
  providers: [PaymentService],
  exports: [PaymentService],
  controllers: [PaymentController],
})
export class PaymentModule {}
