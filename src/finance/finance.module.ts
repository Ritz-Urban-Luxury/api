import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification';
import { PaymentModule } from '../payments/payment.module';
import { AdminFinanceController } from './admin-finance.controller';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';

@Module({
  imports: [PaymentModule, NotificationModule],
  controllers: [FinanceController, AdminFinanceController],
  providers: [FinanceService],
  exports: [FinanceService],
})
export class FinanceModule {}
