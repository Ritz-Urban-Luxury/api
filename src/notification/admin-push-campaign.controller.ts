import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AdminJwtGuard } from '../authentication/guards/jwt.guard';
import { UserDocument } from '../database/schemas/user.schema';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { Response } from '../shared/response';
import {
  CreatePushCampaignDTO,
  PushCampaignAudienceDTO,
  SendTestPushCampaignDTO,
} from './dto/push-campaign.dto';
import { PushCampaignService } from './push-campaign.service';

@Controller('admin/push-campaigns')
@UseGuards(AdminJwtGuard)
export class AdminPushCampaignController {
  constructor(private readonly campaigns: PushCampaignService) {}

  @Get()
  async list() {
    return Response.json('push campaigns', await this.campaigns.list());
  }

  @Post('preview')
  async preview(@Body() payload: PushCampaignAudienceDTO) {
    return Response.json(
      'push campaign audience',
      await this.campaigns.preview(payload),
    );
  }

  @Post('test')
  async test(
    @CurrentUser() admin: UserDocument,
    @Body() payload: SendTestPushCampaignDTO,
  ) {
    return Response.json(
      'test push sent',
      await this.campaigns.sendTest(admin, payload),
    );
  }

  @Post()
  async create(
    @CurrentUser() admin: UserDocument,
    @Body() payload: CreatePushCampaignDTO,
  ) {
    return Response.json(
      'push campaign queued',
      await this.campaigns.create(admin, payload),
    );
  }
}
