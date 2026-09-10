import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
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
  AdminGetRentalsDTO,
  CreateRideDTO,
  GetDrivingRouteDTO,
  GetMyRidesDTO,
  GetRideQuoteDTO,
  GetRidesDTO,
  HireRideDTO,
  MessageDTO,
  OwnerUpdateRentalStatusDTO,
  RatePassengerDTO,
  RequestRideDTO,
  SetRideAvailabilityDTO,
  UpdateRideDTO,
  UpdateTripDTO,
} from './dto/rides.dto';
import { GeolocationService } from './geolocation.service';
import { RidesService } from './rides.service';
import { RideType } from '../database/schemas/rides.schema';

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
  @Get('directions')
  async getDrivingRoute(@Query() payload: GetDrivingRouteDTO) {
    const route = await GeolocationService.getDrivingRoute(
      [Number(payload.fromLat), Number(payload.fromLon)],
      [Number(payload.toLat), Number(payload.toLon)],
    );

    return Response.json('driving route', route);
  }

  @UseVerifiedDriver()
  @Get('me')
  async getMyRides(
    @CurrentUser() user: UserDocument,
    @Query() query: GetMyRidesDTO,
  ) {
    const rides = await this.ridesService.getMyRides(
      user,
      query.type || RideType.Hire,
    );
    return Response.json('my rides', rides);
  }

  @UseVerifiedDriver()
  @Get('me/rentals')
  async getOwnerRentals(
    @CurrentUser() user: UserDocument,
    @Query() query: AdminGetRentalsDTO,
  ) {
    const { docs, ...meta } = await this.ridesService.getOwnerRentals(
      user,
      query,
    );
    return Response.json('owner rentals', docs, meta);
  }

  @UseVerifiedDriver()
  @Get('me/rentals/:rentalId')
  async getOwnerRental(
    @CurrentUser() user: UserDocument,
    @Param('rentalId') rentalId: string,
  ) {
    const rental = await this.ridesService.getOwnerRental(user, rentalId);
    return Response.json('owner rental', rental);
  }

  @UseVerifiedDriver()
  @Patch('me/rentals/:rentalId/status')
  async updateOwnerRentalStatus(
    @CurrentUser() user: UserDocument,
    @Param('rentalId') rentalId: string,
    @Body() payload: OwnerUpdateRentalStatusDTO,
  ) {
    const rental = await this.ridesService.updateOwnerRentalStatus(
      user,
      rentalId,
      payload.status,
    );
    return Response.json('rental updated', rental);
  }

  @UseVerifiedDriver()
  @Get('me/:rideId')
  async getMyRide(
    @CurrentUser() user: UserDocument,
    @Param('rideId') rideId: string,
  ) {
    const ride = await this.ridesService.getMyRide(user, rideId);
    return Response.json('my ride', ride);
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
  @Get('trips/ongoing/location')
  async getOngoingTripLocation(@CurrentUser() user: UserDocument) {
    const location = await this.ridesService.getOngoingTripLocation(user);

    return Response.json('ongoing trip location', location);
  }

  @UseGuards(JwtGuard)
  @Get('trips/:trip')
  async getUserTrip(
    @CurrentUser() user: UserDocument,
    @Param('trip') trip: string,
  ) {
    const _trip = await this.ridesService.getUserTrip(user, trip);

    return Response.json('trip', _trip);
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
  @Put('trips/:trip/passenger-rating')
  async ratePassenger(
    @CurrentUser() user: UserDocument,
    @Body() payload: RatePassengerDTO,
    @Param('trip') tripId: string,
  ) {
    const trip = await this.ridesService.ratePassenger(user, tripId, payload);

    return Response.json('passenger rated', trip);
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
  async toggleRideStatus(
    @CurrentUser() user: UserDocument,
    @Body() payload: SetRideAvailabilityDTO,
  ) {
    const ride = await this.ridesService.setRideAvailability(
      user,
      payload.status,
      payload.rideId,
    );

    return Response.json('ride status updated', ride);
  }

  @UseVerifiedDriver()
  @Put(':rideId/availability')
  async setRideAvailability(
    @CurrentUser() user: UserDocument,
    @Param('rideId') rideId: string,
    @Body() payload: SetRideAvailabilityDTO,
  ) {
    const ride = await this.ridesService.setRideAvailability(
      user,
      payload.status,
      rideId,
    );
    return Response.json('ride status updated', ride);
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

  @UseVerifiedDriver()
  @Delete(':rideId')
  async deleteRide(
    @CurrentUser() user: UserDocument,
    @Param('rideId') rideId: string,
  ) {
    const ride = await this.ridesService.deleteMyRide(user, rideId);
    return Response.json('Ride deleted', ride);
  }
}
