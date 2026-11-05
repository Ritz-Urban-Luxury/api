import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminJwtGuard } from '../authentication/guards/jwt.guard';
import { UserDocument } from '../database/schemas/user.schema';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { Response } from '../shared/response';
import {
  AssignDriverHireBookingDTO,
  ListDriverHireBookingsDTO,
  RejectDriverHireBookingDTO,
  UpdateDriverHireSettingsDTO,
  UpdateInHouseDriverDTO,
} from './dto/driver-hire.dto';
import { DriverHireService } from './driver-hire.service';

@Controller('admin/driver-hire')
@UseGuards(AdminJwtGuard)
export class AdminDriverHireController {
  constructor(private readonly driverHire: DriverHireService) {}

  @Get('bookings')
  async getBookings(@Query() query: ListDriverHireBookingsDTO) {
    const { docs, ...meta } = await this.driverHire.getAdminBookings(query);
    return Response.json('Driver bookings', docs, meta);
  }

  @Get('bookings/:bookingId')
  async getBooking(@Param('bookingId') bookingId: string) {
    return Response.json(
      'Driver booking',
      await this.driverHire.getAdminBooking(bookingId),
    );
  }

  @Post('bookings/:bookingId/assign')
  async assign(
    @CurrentUser() admin: UserDocument,
    @Param('bookingId') bookingId: string,
    @Body() payload: AssignDriverHireBookingDTO,
  ) {
    return Response.json(
      'Driver assigned',
      await this.driverHire.assignDriver(admin, bookingId, payload),
    );
  }

  @Post('bookings/:bookingId/reject')
  async reject(
    @CurrentUser() admin: UserDocument,
    @Param('bookingId') bookingId: string,
    @Body() payload: RejectDriverHireBookingDTO,
  ) {
    return Response.json(
      'Driver request rejected',
      await this.driverHire.rejectBooking(admin, bookingId, payload.reason),
    );
  }

  @Get('drivers')
  async getDrivers() {
    return Response.json(
      'In-house driver candidates',
      await this.driverHire.getDriverCandidates(),
    );
  }

  @Patch('drivers/:driverId/eligibility')
  async setDriverEligibility(
    @Param('driverId') driverId: string,
    @Body() payload: UpdateInHouseDriverDTO,
  ) {
    return Response.json(
      'In-house driver eligibility updated',
      await this.driverHire.setInHouseDriver(driverId, payload.eligible),
    );
  }

  @Get('settings')
  async getSettings() {
    return Response.json(
      'Hire a Driver settings',
      await this.driverHire.getSettings(),
    );
  }

  @Put('settings')
  async updateSettings(
    @CurrentUser() admin: UserDocument,
    @Body() payload: UpdateDriverHireSettingsDTO,
  ) {
    return Response.json(
      'Hire a Driver settings updated',
      await this.driverHire.updateSettings(admin, payload),
    );
  }
}
