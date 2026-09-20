import { Module } from '@nestjs/common';
import { PaymentModule } from '../payments/payment.module';
import { DriverStatsController } from './driver-stats.controller';
import { DriverStatsService } from './driver-stats.service';
import { RidesController } from './rides.controller';
import { RidesService } from './rides.service';
import { AdminRideController } from './admin-rides.controller';
import { FinanceModule } from '../finance/finance.module';

@Module({
  imports: [PaymentModule, FinanceModule],
  providers: [RidesService, DriverStatsService],
  exports: [RidesService, DriverStatsService],
  controllers: [DriverStatsController, RidesController, AdminRideController],
})
export class RidesModule {}
