import { Controller, Get, Query } from '@nestjs/common';
import { UseVerifiedDriver } from 'src/shared/decorators/use-verified-driver.decorator';
import { UserDocument } from '../database/schemas/user.schema';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { Response } from '../shared/response';
import {
  DriverActivityQueryDTO,
  DriverEarningsQueryDTO,
} from './dto/rides.dto';
import { DriverStatsService } from './driver-stats.service';

@Controller('rides/driver')
@UseVerifiedDriver()
export class DriverStatsController {
  constructor(private readonly driverStats: DriverStatsService) {}

  @Get('stats')
  async getStats(@CurrentUser() user: UserDocument) {
    const stats = await this.driverStats.getSummary(user);
    return Response.json('driver stats', stats);
  }

  @Get('earnings')
  async getEarnings(
    @CurrentUser() user: UserDocument,
    @Query() query: DriverEarningsQueryDTO,
  ) {
    const earnings = await this.driverStats.getEarnings(
      user,
      query.timeRange || 'weekly',
      query.period,
    );
    return Response.json('driver earnings', earnings);
  }

  @Get('score')
  async getScore(@CurrentUser() user: UserDocument) {
    const score = await this.driverStats.getScore(user);
    return Response.json('driver score', score);
  }

  @Get('activity')
  async getActivity(
    @CurrentUser() user: UserDocument,
    @Query() query: DriverActivityQueryDTO,
  ) {
    const activity = await this.driverStats.getActivity(
      user,
      query.period || 'week',
    );
    return Response.json('driver activity', activity);
  }
}
