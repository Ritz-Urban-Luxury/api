import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AdminJwtGuard } from 'src/authentication/guards/jwt.guard';
import { Response } from 'src/shared/response';
import { RidesService } from './rides.service';
import { AdminGetRentalsDTO, AdminGetTripsDTO } from './dto/rides.dto';

@Controller('admin/rides')
@UseGuards(AdminJwtGuard)
export class AdminRideController {
  constructor(private readonly ridesService: RidesService) {}

  @Get('/trips')
  async getRides(@Query() query: AdminGetTripsDTO) {
    const { docs, ...meta } = await this.ridesService.getTrips(query);

    return Response.json('trips', docs, meta);
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
}
