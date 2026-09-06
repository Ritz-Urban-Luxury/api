import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminJwtGuard } from 'src/authentication/guards/jwt.guard';
import { Response } from 'src/shared/response';
import { RidesService } from './rides.service';
import {
  AdminGetFleetDTO,
  AdminGetRentalsDTO,
  AdminGetTripsDTO,
  AdminRefundRentalDTO,
  AdminUpdateRentalStatusDTO,
} from './dto/rides.dto';

@Controller('admin/rides')
@UseGuards(AdminJwtGuard)
export class AdminRideController {
  constructor(private readonly ridesService: RidesService) {}

  @Get('/trips')
  async getRides(@Query() query: AdminGetTripsDTO) {
    const { docs, ...meta } = await this.ridesService.getTrips(query);

    return Response.json('trips', docs, meta);
  }

  @Get('/fleet')
  async getFleet(@Query() query: AdminGetFleetDTO) {
    const { docs, ...meta } = await this.ridesService.getAdminFleet(query);
    return Response.json('fleet', docs, meta);
  }

  @Get('/fleet/:rideId')
  async getFleetRide(@Param('rideId') rideId: string) {
    const data = await this.ridesService.getAdminFleetRide(rideId);
    return Response.json('fleet ride', data);
  }

  @Get('/rentals')
  async getRentals(@Query() query: AdminGetRentalsDTO) {
    const { docs, ...meta } = await this.ridesService.getRentals(query);

    return Response.json('rentals', docs, meta);
  }

  @Get('/trips/:tripId')
  async getRide(@Param('tripId') tripId: string) {
    const trip = await this.ridesService.getTrip(tripId);

    return Response.json('trip', trip);
  }

  @Get('/rentals/:rentalId')
  async getRental(@Param('rentalId') rentalId: string) {
    const rental = await this.ridesService.getRental(rentalId);

    return Response.json('rental', rental);
  }

  @Patch('/rentals/:rentalId/status')
  async updateRentalStatus(
    @Param('rentalId') rentalId: string,
    @Body() payload: AdminUpdateRentalStatusDTO,
  ) {
    const rental = await this.ridesService.updateRentalStatus(
      rentalId,
      payload.status,
    );

    return Response.json('rental updated', rental);
  }

  @Post('/rentals/:rentalId/refund')
  async refundRental(
    @Param('rentalId') rentalId: string,
    @Body() payload: AdminRefundRentalDTO,
  ) {
    const rental = await this.ridesService.refundRental(
      rentalId,
      payload.amount,
    );

    return Response.json('rental refunded', rental);
  }
}
