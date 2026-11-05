import { Module } from '@nestjs/common';
import { PaymentModule } from '../payments/payment.module';
import { AdminDriverHireController } from './admin-driver-hire.controller';
import { DriverAssignmentController } from './driver-assignment.controller';
import { DriverHireController } from './driver-hire.controller';
import { DriverHireService } from './driver-hire.service';

@Module({
  imports: [PaymentModule],
  controllers: [
    DriverHireController,
    AdminDriverHireController,
    DriverAssignmentController,
  ],
  providers: [DriverHireService],
  exports: [DriverHireService],
})
export class DriverHireModule {}
