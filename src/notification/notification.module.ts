import { Global, Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { PushNotificationService } from './push-notification.service';
import { AdminPushCampaignController } from './admin-push-campaign.controller';
import { PushCampaignService } from './push-campaign.service';
import { AdminNewsController } from './admin-news.controller';
import { NewsController } from './news.controller';
import { NewsService } from './news.service';

@Global()
@Module({
  controllers: [
    AdminPushCampaignController,
    AdminNewsController,
    NewsController,
  ],
  providers: [
    NotificationService,
    PushNotificationService,
    PushCampaignService,
    NewsService,
  ],
  exports: [NotificationService, PushNotificationService, PushCampaignService],
})
export class NotificationModule {}
