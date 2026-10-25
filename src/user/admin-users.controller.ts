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
import { SuperAdminGuard } from 'src/authentication/guards/super-admin.guard';
import { Response } from 'src/shared/response';
import {
  AdminGetDriversDTO,
  AdminCreateDriverDTO,
  AdminListUsersDTO,
  PurgeTestAccountDTO,
  SetUserVerificationDTO,
} from './dto/user.dto';
import { ReviewDriverApplicationDTO } from './dto/driver-review.dto';
import { PermanentlyDeleteUserDTO } from './dto/permanently-delete-user.dto';
import { UserService } from './user.service';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { UserDocument } from '../database/schemas/user.schema';
import { TestAccountService } from './test-account.service';

@Controller('admin/users')
@UseGuards(AdminJwtGuard)
export class AdminUserController {
  constructor(
    private readonly userService: UserService,
    private readonly testAccounts: TestAccountService,
  ) {}

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

  @Post('/app-review/reset')
  async resetAppReviewData(@CurrentUser() admin: UserDocument) {
    return Response.json(
      'app-review data reset',
      await this.testAccounts.resetAppReviewData(admin),
    );
  }

  @Get('/:userId/test-purge-preview')
  async previewTestPurge(@Param('userId') userId: string) {
    return Response.json(
      'test-account purge preview',
      await this.testAccounts.preview(userId),
    );
  }

  @Post('/:userId/test-purge')
  async purgeTestAccount(
    @CurrentUser() admin: UserDocument,
    @Param('userId') userId: string,
    @Body() payload: PurgeTestAccountDTO,
  ) {
    return Response.json(
      'test account permanently purged',
      await this.testAccounts.purge(admin, userId, payload),
    );
  }

  @Get('/:userId/permanent-delete-preview')
  @UseGuards(SuperAdminGuard)
  async previewPermanentDelete(@Param('userId') userId: string) {
    return Response.json(
      'permanent deletion preview',
      await this.testAccounts.previewPermanent(userId),
    );
  }

  @Post('/:userId/permanent-delete')
  @UseGuards(SuperAdminGuard)
  async permanentlyDeleteUser(
    @CurrentUser() admin: UserDocument,
    @Param('userId') userId: string,
    @Body() payload: PermanentlyDeleteUserDTO,
  ) {
    return Response.json(
      'user permanently deleted',
      await this.testAccounts.purgePermanent(admin, userId, payload),
    );
  }

  @Put('/:userId/verification')
  async setVerification(
    @Param('userId') userId: string,
    @Body() payload: SetUserVerificationDTO,
  ) {
    const user = await this.userService.setVerification(userId, payload);

    return Response.json('user verification updated', user);
  }

  @Put('/drivers/:userId/review')
  async reviewDriverApplication(
    @CurrentUser() admin: UserDocument,
    @Param('userId') userId: string,
    @Body() payload: ReviewDriverApplicationDTO,
  ) {
    const detail = await this.userService.reviewDriverApplication(
      admin,
      userId,
      payload,
    );
    return Response.json('driver application reviewed', detail);
  }
}
