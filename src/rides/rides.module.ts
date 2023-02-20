import { Module } from '@nestjs/common';
import { RidesController } from './rides.controller';
import { RidesService } from './rides.service';

@Module({
  providers: [RidesService],
  exports: [RidesService],
  controllers: [RidesController],
})
export class RidesModule {}
