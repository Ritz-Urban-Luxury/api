import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UserDocument } from '../database/schemas/user.schema';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { UseVerifiedDriver } from '../shared/decorators/use-verified-driver.decorator';
import { Response } from '../shared/response';
import {
  ListDriverHireBookingsDTO,
  UpdateDriverHireStatusDTO,
} from './dto/driver-hire.dto';
import { DriverHireService } from './driver-hire.service';

@Controller('driver-hire/driver')
@UseVerifiedDriver()
export class DriverAssignmentController {
  constructor(private readonly driverHire: DriverHireService) {}

  @Get('assignments')
  async getAssignments(
    @CurrentUser() driver: UserDocument,
    @Query() query: ListDriverHireBookingsDTO,
  ) {
    const { docs, ...meta } = await this.driverHire.getDriverAssignments(
      driver,
      query,
    );
    return Response.json('Driver assignments', docs, meta);
  }

  @Get('assignments/:bookingId')
  async getAssignment(
    @CurrentUser() driver: UserDocument,
    @Param('bookingId') bookingId: string,
  ) {
    return Response.json(
      'Driver assignment',
      await this.driverHire.getDriverAssignment(driver, bookingId),
    );
  }

  @Patch('assignments/:bookingId/status')
  async updateStatus(
    @CurrentUser() driver: UserDocument,
    @Param('bookingId') bookingId: string,
    @Body() payload: UpdateDriverHireStatusDTO,
  ) {
    return Response.json(
      'Driver assignment updated',
      await this.driverHire.updateDriverStatus(
        driver,
        bookingId,
        payload.status,
      ),
    );
  }

  @Post('assignments/:bookingId/handover-code')
  async generateHandoverCode(
    @CurrentUser() driver: UserDocument,
    @Param('bookingId') bookingId: string,
  ) {
    return Response.json(
      'Handover verification code generated',
      await this.driverHire.generateHandoverCode(driver, bookingId),
    );
  }
}
