import { Global, Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { PushNotificationService } from './push-notification.service';
import { AdminPushCampaignController } from './admin-push-campaign.controller';
import { PushCampaignService } from './push-campaign.service';

@Global()
@Module({
  controllers: [AdminPushCampaignController],
  providers: [
    NotificationService,
    PushNotificationService,
    PushCampaignService,
  ],
  exports: [NotificationService, PushNotificationService, PushCampaignService],
})
export class NotificationModule {}
