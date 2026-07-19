import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminJwtGuard } from 'src/authentication/guards/jwt.guard';
import { Response } from 'src/shared/response';
import { AdminGetDriversDTO, SetUserVerificationDTO } from './dto/user.dto';
import { UserService } from './user.service';

@Controller('admin/users')
@UseGuards(AdminJwtGuard)
export class AdminUserController {
  constructor(private readonly userService: UserService) {}

  @Get('/drivers')
  async listDrivers(@Query() query: AdminGetDriversDTO) {
    const { docs, ...meta } = await this.userService.listDrivers(query);

    return Response.json('drivers', docs, meta);
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
