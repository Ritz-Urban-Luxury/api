import {
  BadRequestException,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
  PushCampaignAudience,
  PushCampaignDocument,
  PushCampaignStatus,
} from '../database/schemas/push-campaign.schema';
import {
  PushApp,
  PushDevice,
  UserDocument,
} from '../database/schemas/user.schema';
import { Logger } from '../logger/logger.service';
import {
  CreatePushCampaignDTO,
  PushCampaignAudienceDTO,
  SendTestPushCampaignDTO,
} from './dto/push-campaign.dto';
import {
  PushDispatchResult,
  PushNotificationService,
} from './push-notification.service';

const CAMPAIGN_POLL_INTERVAL_MS = 10_000;
const USER_BATCH_SIZE = 200;
const DEFAULT_RIDER_URL = '/(main)/(shared)/Promotions';
const DEFAULT_DRIVER_URL = '/(main)/inbox/campaigns';

type CampaignTotals = {
  targetedUsers: number;
  targetedDevices: number;
  accepted: number;
  failed: number;
  invalidTokens: number;
};

@Injectable()
export class PushCampaignService implements OnModuleInit, OnModuleDestroy {
  private pollTimer?: NodeJS.Timeout;

  private processing = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly push: PushNotificationService,
    private readonly logger: Logger,
  ) {}

  onModuleInit(): void {
    this.pollTimer = setInterval(() => {
      this.processQueue().catch((error) => {
        this.logger.error(
          `Push campaign worker failed: ${(error as Error).message}`,
        );
      });
    }, CAMPAIGN_POLL_INTERVAL_MS);
    this.pollTimer.unref();

    this.processQueue().catch((error) => {
      this.logger.error(
        `Push campaign worker failed: ${(error as Error).message}`,
      );
    });
  }

  onModuleDestroy(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }
  }

  async create(admin: UserDocument, payload: CreatePushCampaignDTO) {
    const scheduledAt = payload.scheduledAt
      ? new Date(payload.scheduledAt)
      : new Date();
    if (Number.isNaN(scheduledAt.getTime())) {
      throw new BadRequestException('invalid campaign schedule');
    }

    const campaign = await this.db.pushCampaigns.create({
      title: payload.title,
      body: payload.body,
      audience: payload.audience,
      riderUrl: payload.riderUrl || DEFAULT_RIDER_URL,
      driverUrl: payload.driverUrl || DEFAULT_DRIVER_URL,
      createdBy: admin.id,
      scheduledAt,
      status: PushCampaignStatus.Queued,
    });

    this.processQueue().catch((error) => {
      this.logger.error(
        `Push campaign worker failed: ${(error as Error).message}`,
      );
    });

    return campaign;
  }

  async list() {
    return this.db.pushCampaigns
      .find({ deleted: { $ne: true } })
      .populate('createdBy', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .limit(100);
  }

  async preview(payload: PushCampaignAudienceDTO) {
    const apps = this.appsForAudience(payload.audience);
    const [summary] = await this.db.users.aggregate<{
      targetedUsers: number;
      targetedDevices: number;
    }>([
      {
        $match: {
          deleted: { $ne: true },
          'preferences.marketingPushEnabled': { $ne: false },
          pushDevices: { $elemMatch: { app: { $in: apps } } },
        },
      },
      { $unwind: '$pushDevices' },
      { $match: { 'pushDevices.app': { $in: apps } } },
      {
        $group: {
          _id: null,
          users: { $addToSet: '$_id' },
          devices: { $addToSet: '$pushDevices.token' },
        },
      },
      {
        $project: {
          _id: 0,
          targetedUsers: { $size: '$users' },
          targetedDevices: { $size: '$devices' },
        },
      },
    ]);

    return summary || { targetedUsers: 0, targetedDevices: 0 };
  }

  async sendTest(admin: UserDocument, payload: SendTestPushCampaignDTO) {
    const user = await this.db.users.findById(admin.id).select('pushDevices');
    if (!user) {
      throw new BadRequestException('admin account not found');
    }

    const apps = this.appsForAudience(payload.audience);
    const devices = (user.pushDevices || []).filter((device) =>
      apps.includes(device.app),
    );
    if (!devices.length) {
      throw new BadRequestException(
        'No matching Rider or Driver device is registered for your admin account',
      );
    }

    const totals = this.emptyTotals();
    totals.targetedUsers = 1;
    const results = await Promise.all(
      apps.map((app) =>
        this.push.dispatchToDevices(
          devices.filter((device) => device.app === app),
          {
            app,
            title: `[TEST] ${payload.title}`,
            body: payload.body,
            data: this.campaignData('test', app, payload),
          },
        ),
      ),
    );
    results.forEach((result) => this.addDispatchResult(totals, result));
    const invalidTokens = results.reduce<string[]>(
      (tokens, result) => [...tokens, ...result.invalidTokens],
      [],
    );

    if (invalidTokens.length > 0) {
      await this.removeInvalidTokens(invalidTokens);
    }

    return totals;
  }

  private async processQueue() {
    if (this.processing) {
      return;
    }
    this.processing = true;

    try {
      await this.drainQueue();
    } finally {
      this.processing = false;
    }
  }

  private async drainQueue(): Promise<void> {
    const campaign = await this.claimNextCampaign();
    if (!campaign) {
      return;
    }
    await this.processCampaign(campaign);
    await this.drainQueue();
  }

  private claimNextCampaign() {
    return this.db.pushCampaigns.findOneAndUpdate(
      {
        status: PushCampaignStatus.Queued,
        scheduledAt: { $lte: new Date() },
        deleted: { $ne: true },
      },
      {
        $set: {
          status: PushCampaignStatus.Sending,
          startedAt: new Date(),
          failureReason: null,
        },
      },
      { new: true, sort: { scheduledAt: 1, createdAt: 1 } },
    );
  }

  private async processCampaign(campaign: PushCampaignDocument) {
    const totals = this.emptyTotals();
    const apps = this.appsForAudience(campaign.audience);

    try {
      await this.processCampaignBatch(campaign, apps, totals);

      await this.db.pushCampaigns.updateOne(
        { _id: campaign.id },
        {
          $set: {
            ...totals,
            status: PushCampaignStatus.Completed,
            completedAt: new Date(),
          },
        },
      );
    } catch (error) {
      await this.db.pushCampaigns.updateOne(
        { _id: campaign.id },
        {
          $set: {
            ...totals,
            status: PushCampaignStatus.Failed,
            completedAt: new Date(),
            failureReason: (error as Error).message,
          },
        },
      );
      this.logger.error(
        `Push campaign ${campaign.id} failed: ${(error as Error).message}`,
      );
    }
  }

  private async processCampaignBatch(
    campaign: PushCampaignDocument,
    apps: PushApp[],
    totals: CampaignTotals,
    lastUserId?: unknown,
  ): Promise<void> {
    const users = await this.db.users
      .find({
        deleted: { $ne: true },
        'preferences.marketingPushEnabled': { $ne: false },
        pushDevices: { $elemMatch: { app: { $in: apps } } },
        ...(lastUserId ? { _id: { $gt: lastUserId } } : {}),
      })
      .select('_id pushDevices')
      .sort({ _id: 1 })
      .limit(USER_BATCH_SIZE);

    if (!users.length) {
      return;
    }

    const matchingUsers = users
      .map((user) =>
        (user.pushDevices || []).filter((device) => apps.includes(device.app)),
      )
      .filter((devices) => devices.length > 0);
    totals.targetedUsers += matchingUsers.length;

    const results = await Promise.all(
      apps.map((app) => {
        const appDevices = matchingUsers.reduce<PushDevice[]>(
          (devices, userDevices) => [
            ...devices,
            ...userDevices.filter((device) => device.app === app),
          ],
          [],
        );
        return this.push.dispatchToDevices(appDevices, {
          app,
          title: campaign.title,
          body: campaign.body,
          data: this.campaignData(String(campaign.id), app, campaign),
        });
      }),
    );

    results.forEach((result) => this.addDispatchResult(totals, result));
    const invalidTokens = results.reduce<string[]>(
      (tokens, result) => [...tokens, ...result.invalidTokens],
      [],
    );
    await this.removeInvalidTokens(invalidTokens);
    await this.db.pushCampaigns.updateOne(
      { _id: campaign.id },
      { $set: totals },
    );

    if (users.length === USER_BATCH_SIZE) {
      await this.processCampaignBatch(
        campaign,
        apps,
        totals,
        users[users.length - 1]._id,
      );
    }
  }

  private appsForAudience(audience: PushCampaignAudience): PushApp[] {
    if (audience === PushCampaignAudience.Rider) {
      return ['rider'];
    }
    if (audience === PushCampaignAudience.Driver) {
      return ['driver'];
    }
    return ['rider', 'driver'];
  }

  private campaignData(
    campaignId: string,
    app: PushApp,
    campaign: Pick<CreatePushCampaignDTO, 'riderUrl' | 'driverUrl'>,
  ) {
    return {
      type: 'Promotion',
      campaignId,
      url:
        app === 'rider'
          ? campaign.riderUrl || DEFAULT_RIDER_URL
          : campaign.driverUrl || DEFAULT_DRIVER_URL,
    };
  }

  private emptyTotals(): CampaignTotals {
    return {
      targetedUsers: 0,
      targetedDevices: 0,
      accepted: 0,
      failed: 0,
      invalidTokens: 0,
    };
  }

  private addDispatchResult(
    totals: CampaignTotals,
    result: PushDispatchResult,
  ) {
    totals.targetedDevices += result.targeted;
    totals.accepted += result.accepted;
    totals.failed += result.failed;
    totals.invalidTokens += result.invalidTokens.length;
  }

  private async removeInvalidTokens(tokens: string[]) {
    if (!tokens.length) {
      return;
    }
    await this.db.users.updateMany(
      { 'pushDevices.token': { $in: tokens } },
      { $pull: { pushDevices: { token: { $in: tokens } } } },
    );
  }
}
