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
  MessageDTO,
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
  @Get('trips/ongoing')
  async getOngoingTrip(@CurrentUser() user: UserDocument) {
    const ongoingTrip = await this.ridesService.getOngoingTrip(user);

    return Response.json('ongoing trip', ongoingTrip);
  }

  @UseGuards(JwtGuard)
  @Delete('trips/:trip')
  async cancelTrip(
    @CurrentUser() user: UserDocument,
    @Param('trip') trip: string,
    @Query('reason') reason: string,
  ) {
    const _trip = await this.ridesService.cancelTrip(user, trip, reason);

    return Response.json('Trip cancelled', _trip);
  }

  @UseGuards(JwtGuard)
  @Post('trips/:trip/messages')
  async sendMessage(
    @CurrentUser() user: UserDocument,
    @Param('trip') trip: string,
    @Body() payload: MessageDTO,
  ) {
    const message = await this.ridesService.sendMessage(user, trip, payload);

    return Response.json('Message sent', message);
  }

  @UseGuards(JwtGuard)
  @Get('trips/:trip/messages')
  async getMessages(
    @CurrentUser() user: UserDocument,
    @Param('trip') trip: string,
  ) {
    const messages = await this.ridesService.getMessages(user, trip);

    return Response.json('Trip messages', messages);
  }
}
