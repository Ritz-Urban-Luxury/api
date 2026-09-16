import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../authentication/guards/jwt.guard';
import { ReferralService } from '../database/referral.service';
import { UserDocument } from '../database/schemas/user.schema';
import { PushNotificationService } from '../notification/push-notification.service';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { Response } from '../shared/response';
import {
  ApplyReferralDTO,
  DeleteAccountDTO,
  RemovePushTokenDTO,
  UpdateUserDTO,
  UpsertPushTokenDTO,
} from './dto/user.dto';
import { UserService } from './user.service';

@Controller('users')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly pushNotificationService: PushNotificationService,
    private readonly referralService: ReferralService,
  ) {}

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
  async getUser(@CurrentUser() user: UserDocument) {
    await this.referralService.ensureInviteCode(user);
    const refreshed = await this.userService.getUserById(user.id);
    return Response.json('profile', refreshed || user);
  }

  @UseGuards(JwtGuard)
  @Get('/me/invite')
  async getInvite(@CurrentUser() user: UserDocument) {
    const summary = await this.referralService.getInviteSummary(user);
    return Response.json('invite', summary);
  }

  @UseGuards(JwtGuard)
  @Post('/me/referral')
  async applyReferral(
    @CurrentUser() user: UserDocument,
    @Body() payload: ApplyReferralDTO,
  ) {
    const result = await this.referralService.applyReferralCode(
      user,
      payload.referralCode,
    );
    return Response.json('referral applied', result);
  }

  @UseGuards(JwtGuard)
  @Get('/preferences')
  getPrefences(@CurrentUser() user: UserDocument) {
    return Response.json('preferences', user.preferences || {});
  }

  @UseGuards(JwtGuard)
  @Put('/preferences')
  async updatePrefences(
    @CurrentUser() user: UserDocument,
    @Body() payload: Record<string, unknown>,
  ) {
    const preferences = await this.userService.updatePreference(user, payload);

    return Response.json('preferences updated', preferences);
  }

  @UseGuards(JwtGuard)
  @Put('/me/push-token')
  async upsertPushToken(
    @CurrentUser() user: UserDocument,
    @Body() payload: UpsertPushTokenDTO,
  ) {
    const devices = await this.pushNotificationService.upsertDevice(
      user,
      payload,
    );

    return Response.json('push token saved', { count: devices.length });
  }

  @UseGuards(JwtGuard)
  @Delete('/me')
  async deleteAccount(
    @CurrentUser() user: UserDocument,
    @Body() payload: DeleteAccountDTO,
  ) {
    const result = await this.userService.deleteAccount(user, payload);

    return Response.json('account deleted', result);
  }

  @UseGuards(JwtGuard)
  @Delete('/me/push-token')
  async removePushToken(
    @CurrentUser() user: UserDocument,
    @Body() payload: RemovePushTokenDTO,
  ) {
    const devices = await this.pushNotificationService.removeDevice(
      user,
      payload.token,
    );

    return Response.json('push token removed', { count: devices.length });
  }
}
