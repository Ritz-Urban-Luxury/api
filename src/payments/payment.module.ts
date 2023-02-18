import { Module } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { MonnifyService } from './providers/monnify/monify.service';

@Module({
  providers: [PaymentService, MonnifyService],
  exports: [PaymentService],
  controllers: [PaymentController],
})
export class PaymentModule {}
