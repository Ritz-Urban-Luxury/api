import { MiddlewareConsumer, Module } from '@nestjs/common';
import { TripMiddleware } from 'src/shared/middlewares/trip.middleware';
import { RidesController } from './rides.controller';
import { RidesService } from './rides.service';

@Module({
  providers: [RidesService],
  exports: [RidesService],
  controllers: [RidesController],
})
export class RidesModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TripMiddleware).forRoutes('rides/trips/:trip');
  }
}
