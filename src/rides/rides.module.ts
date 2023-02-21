import { Module } from '@nestjs/common';
import { PaymentModule } from '../payments/payment.module';
import { RidesController } from './rides.controller';
import { RidesService } from './rides.service';

@Module({
  imports: [PaymentModule],
  providers: [RidesService],
  exports: [RidesService],
  controllers: [RidesController],
})
export class RidesModule {}
