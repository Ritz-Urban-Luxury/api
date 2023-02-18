import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from 'src/authentication/guards/jwt.guard';
import { UserDocument } from 'src/database/schemas/user.schema';
import { CurrentUser } from 'src/shared/decorators/current-user.decorator';
import { Response } from 'src/shared/response';
import {
  AcceptRideDTO,
  GetRideQuoteDTO,
  GetRidesDTO,
  RequestRideDTO,
} from './dto/rides.dto';
import { RidesService } from './rides.service';

@Controller('rides')
export class RidesController {
  constructor(private readonly ridesService: RidesService) {}

  @UseGuards(JwtGuard)
  @Get()
  async getAvailableRides(@Query() payload: GetRidesDTO) {
    const rides = await this.ridesService.getAvailableRides(payload);

    return Response.json('available rides', rides);
  }

  @UseGuards(JwtGuard)
  @Get('quotes')
  async getRideQuote(@Query() payload: GetRideQuoteDTO) {
    const quotes = await this.ridesService.getRideQuotes(payload);

    return Response.json('ride quotes', quotes);
  }

  @UseGuards(JwtGuard)
  @Post('trips')
  async requestRide(
    @CurrentUser() user: UserDocument,
    @Body() payload: RequestRideDTO,
  ) {
    const driver = await this.ridesService.requestRide(user, payload);

    return Response.json('Connecting you to driver', driver);
  }

  @UseGuards(JwtGuard)
  @Put('trips')
  async acceptRideRequest(@Query() payload: AcceptRideDTO) {
    await this.ridesService.acceptRide(payload);

    return Response.json('Accepting ride request');
  }

  @UseGuards(JwtGuard)
  @Delete('trips')
  async cancelRideRequest(@Query() payload: AcceptRideDTO) {
    await this.ridesService.cancelConnection(payload);

    return Response.json('Cancelling ride request');
  }

  @UseGuards(JwtGuard)
  @Delete('trips/:id')
  async cancelTrip(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Query('reason') reason: string,
  ) {
    const trip = await this.ridesService.cancelTrip(user, id, reason);

    return Response.json('Trip cancelled', trip);
  }
}
