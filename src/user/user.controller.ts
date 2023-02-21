import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { JwtGuard } from 'src/authentication/guards/jwt.guard';
import { UserDocument } from 'src/database/schemas/user.schema';
import { CurrentUser } from 'src/shared/decorators/current-user.decorator';
import { Response } from 'src/shared/response';
import { UpdateUserDTO } from './dto/user.dto';
import { UserService } from './user.service';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @UseGuards(JwtGuard)
  @Put('/me')
  async updateUser(
    @CurrentUser() user: UserDocument,
    @Body() payload: UpdateUserDTO,
  ) {
    const updateUser = await this.userService.updateUser(user, payload);

    return Response.json('profile updated', updateUser);
  }

  @UseGuards(JwtGuard)
  @Get('/me')
  getUser(@CurrentUser() user: UserDocument) {
    return Response.json('profile', user);
  }
}
