import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../authentication/guards/jwt.guard';
import { UserDocument } from '../database/schemas/user.schema';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { Response } from '../shared/response';
import {
  AcceptDriverHireTermsDTO,
  CancelDriverHireBookingDTO,
  CreateDriverHireBookingDTO,
  ListDriverHireBookingsDTO,
  RequestDriverChangeDTO,
  RescheduleDriverHireDTO,
  VerifyDriverHireHandoverDTO,
} from './dto/driver-hire.dto';
import { DriverHireService } from './driver-hire.service';

@Controller('driver-hire')
@UseGuards(JwtGuard)
export class DriverHireController {
  constructor(private readonly driverHire: DriverHireService) {}

  @Get('terms')
  async getTerms(@CurrentUser() user: UserDocument) {
    return Response.json(
      'Hire a Driver terms',
      await this.driverHire.getTerms(user),
    );
  }

  @Post('terms/accept')
  async acceptTerms(
    @CurrentUser() user: UserDocument,
    @Body() payload: AcceptDriverHireTermsDTO,
  ) {
    if (!payload.accepted) {
      return Response.json('Hire a Driver terms not accepted', null);
    }
    return Response.json(
      'Hire a Driver terms accepted',
      await this.driverHire.acceptTerms(user, payload.version),
    );
  }

  @Get('settings')
  async getSettings() {
    return Response.json(
      'Hire a Driver settings',
      await this.driverHire.getSettings(),
    );
  }

  @Post('bookings')
  async createBooking(
    @CurrentUser() user: UserDocument,
    @Body() payload: CreateDriverHireBookingDTO,
  ) {
    return Response.json(
      'Driver request submitted',
      await this.driverHire.createBooking(user, payload),
    );
  }

  @Get('bookings')
  async getMyBookings(
    @CurrentUser() user: UserDocument,
    @Query() query: ListDriverHireBookingsDTO,
  ) {
    const { docs, ...meta } = await this.driverHire.getMyBookings(user, query);
    return Response.json('Driver bookings', docs, meta);
  }

  @Get('bookings/:bookingId')
  async getMyBooking(
    @CurrentUser() user: UserDocument,
    @Param('bookingId') bookingId: string,
  ) {
    return Response.json(
      'Driver booking',
      await this.driverHire.getMyBooking(user, bookingId),
    );
  }

  @Post('bookings/:bookingId/cancel')
  async cancelBooking(
    @CurrentUser() user: UserDocument,
    @Param('bookingId') bookingId: string,
    @Body() payload: CancelDriverHireBookingDTO,
  ) {
    return Response.json(
      'Driver booking cancelled',
      await this.driverHire.cancelBooking(user, bookingId, payload.reason),
    );
  }

  @Post('bookings/:bookingId/reschedule')
  async rescheduleBooking(
    @CurrentUser() user: UserDocument,
    @Param('bookingId') bookingId: string,
    @Body() payload: RescheduleDriverHireDTO,
  ) {
    return Response.json(
      'Driver service rescheduled',
      await this.driverHire.rescheduleBooking(user, bookingId, payload),
    );
  }

  @Post('bookings/:bookingId/driver-change-requests')
  async requestDriverChange(
    @CurrentUser() user: UserDocument,
    @Param('bookingId') bookingId: string,
    @Body() payload: RequestDriverChangeDTO,
  ) {
    return Response.json(
      'Driver change requested',
      await this.driverHire.requestDriverChange(user, bookingId, payload),
    );
  }

  @Post('bookings/:bookingId/handover/verify')
  async verifyHandover(
    @CurrentUser() user: UserDocument,
    @Param('bookingId') bookingId: string,
    @Body() payload: VerifyDriverHireHandoverDTO,
  ) {
    return Response.json(
      'Driver identity confirmed',
      await this.driverHire.verifyHandoverCode(user, bookingId, payload.code),
    );
  }
}
