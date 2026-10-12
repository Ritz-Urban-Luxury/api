import { Module } from '@nestjs/common';
import { AdminPricingController } from './admin-pricing.controller';

/** Admin endpoints for ride pricing. PricingService itself lives in the global DatabaseModule. */
@Module({
  controllers: [AdminPricingController],
})
export class PricingModule {}
