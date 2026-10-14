import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminJwtGuard } from 'src/authentication/guards/jwt.guard';
import { Response } from 'src/shared/response';
import {
  AdminGetDriversDTO,
  AdminCreateDriverDTO,
  AdminListUsersDTO,
  SetUserVerificationDTO,
} from './dto/user.dto';
import { UserService } from './user.service';

@Controller('admin/users')
@UseGuards(AdminJwtGuard)
export class AdminUserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  async listUsers(@Query() query: AdminListUsersDTO) {
    const { docs, ...meta } = await this.userService.listUsers(query);

    return Response.json('users', docs, meta);
  }

  @Get('/drivers')
  async listDrivers(@Query() query: AdminGetDriversDTO) {
    const { docs, ...meta } = await this.userService.listDrivers(query);

    return Response.json('drivers', docs, meta);
  }

  @Post('/drivers')
  async createDriver(@Body() payload: AdminCreateDriverDTO) {
    const driver = await this.userService.createDriver(payload);

    return Response.json('driver created', driver);
  }

  @Get('/drivers/:userId')
  async getDriver(@Param('userId') userId: string) {
    const detail = await this.userService.getDriverDetail(userId);

    return Response.json('driver', detail);
  }

  @Put('/:userId/verification')
  async setVerification(
    @Param('userId') userId: string,
    @Body() payload: SetUserVerificationDTO,
  ) {
    const user = await this.userService.setVerification(userId, payload);

    return Response.json('user verification updated', user);
  }
}
