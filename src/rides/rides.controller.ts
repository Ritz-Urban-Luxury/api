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
import { UseVerifiedDriver } from 'src/shared/decorators/use-verified-driver.decorator';
import { JwtGuard } from '../authentication/guards/jwt.guard';
import { UserDocument } from '../database/schemas/user.schema';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { PaginationRequestDTO } from '../shared/pagination.dto';
import { Response } from '../shared/response';
import {
  AcceptRideDTO,
  CreateRideDTO,
  GetRideQuoteDTO,
  GetRidesDTO,
  HireRideDTO,
  MessageDTO,
  RequestRideDTO,
  UpdateRideDTO,
  UpdateTripDTO,
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

  @Get('/brands')
  async getCarBrands() {
    const brands = await this.ridesService.getCarBrands();

    return Response.json('car brands', brands);
  }

  @UseGuards(JwtGuard)
  @Get('rentals/brands')
  async getRentalCarBrands(@Query() payload: PaginationRequestDTO) {
    const { data, meta } = await this.ridesService.getRentalCarBrands(payload);

    return Response.json('car brands', data, meta);
  }

  @UseGuards(JwtGuard)
  @Get('quotes')
  async getRideQuote(@Query() payload: GetRideQuoteDTO) {
    const quotes = await this.ridesService.getRideQuotes(payload);

    return Response.json('ride quotes', quotes);
  }

  @UseGuards(JwtGuard)
  @Get('/trips')
  async getTrips(
    @CurrentUser() user: UserDocument,
    @Query() payload: PaginationRequestDTO,
  ) {
    const { docs: data, ...meta } = await this.ridesService.getTripHistory(
      user,
      payload,
    );

    return Response.json('trips', data, meta);
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
  async cancelRideRequest(
    @CurrentUser() user: UserDocument,
    @Query() payload: AcceptRideDTO,
  ) {
    await this.ridesService.cancelConnection(user, payload);

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

  @UseGuards(JwtGuard)
  @Put('trips/:trip')
  async updateTrip(
    @CurrentUser() user: UserDocument,
    @Body() payload: UpdateTripDTO,
    @Param('trip') tripId: string,
  ) {
    const trip = await this.ridesService.updateTrip(user, tripId, payload);

    return Response.json('trip updated', trip);
  }

  @UseGuards(JwtGuard)
  @Post('rentals')
  async hireARide(
    @CurrentUser() user: UserDocument,
    @Body() payload: HireRideDTO,
  ) {
    const rental = await this.ridesService.hireARide(user, payload);

    return Response.json('car rented', rental);
  }

  @UseGuards(JwtGuard)
  @Get('rentals/ongoing')
  async getOngoingRental(@CurrentUser() user: UserDocument) {
    const ongoingRental = await this.ridesService.getOngoingRental(user, {});

    return Response.json('ongoing trip', ongoingRental);
  }

  @UseGuards(JwtGuard)
  @Get(':id')
  async getSingleRide(@Param('id') rideId: string) {
    const ride = await this.ridesService.getSingleRide(rideId);

    return Response.json('ride found successfully', ride);
  }

  @UseGuards(JwtGuard)
  @Post()
  async createRide(
    @CurrentUser() user: UserDocument,
    @Body() payload: CreateRideDTO,
  ) {
    const ride = await this.ridesService.createRide(user, payload);

    return Response.json('Ride created', ride);
  }

  @UseVerifiedDriver()
  @Put('toggle-ride')
  async toggleRideStatus(@CurrentUser() user: UserDocument) {
    const ride = await this.ridesService.toggleRideStatus(user);

    return Response.json('ride status toggled', ride);
  }

  @UseGuards(JwtGuard)
  @Put(':rideId')
  async updateRide(
    @CurrentUser() user: UserDocument,
    @Param('rideId') rideid: string,
    @Body() payload: UpdateRideDTO,
  ) {
    const ride = await this.ridesService.updateRide(user, rideid, payload);

    return Response.json('Ride updated', ride);
  }
}
