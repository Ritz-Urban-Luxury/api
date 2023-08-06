import { Module } from '@nestjs/common';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { MonnifyService } from './providers/monnify/monify.service';
import { PaystackService } from './providers/paystack/paystack.service';

@Module({
  providers: [PaymentService, MonnifyService, PaystackService],
  exports: [PaymentService],
  controllers: [PaymentController],
})
export class PaymentModule {}
