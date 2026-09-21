import { PushCampaignAudience } from '../database/schemas/push-campaign.schema';
import { PushCampaignService } from './push-campaign.service';

describe('PushCampaignService', () => {
  const pushCampaigns = {
    create: jest.fn(),
    findOneAndUpdate: jest.fn(),
  };
  const users = {
    aggregate: jest.fn(),
    findById: jest.fn(),
    updateMany: jest.fn(),
  };
  const push = {
    dispatchToDevices: jest.fn(),
  };
  const logger = {
    error: jest.fn(),
    warn: jest.fn(),
  };

  let service: PushCampaignService;

  beforeEach(() => {
    jest.clearAllMocks();
    pushCampaigns.findOneAndUpdate.mockResolvedValue(null);
    service = new PushCampaignService(
      { pushCampaigns, users } as never,
      push as never,
      logger as never,
    );
  });

  it('queues a campaign with safe default app destinations', async () => {
    const campaign = { id: 'campaign-id', status: 'queued' };
    pushCampaigns.create.mockResolvedValue(campaign);

    await expect(
      service.create({ id: 'admin-id' } as never, {
        audience: PushCampaignAudience.Both,
        title: 'Weekend offer',
        body: 'Save on your next trip.',
      }),
    ).resolves.toBe(campaign);

    expect(pushCampaigns.create).toHaveBeenCalledWith(
      expect.objectContaining({
        audience: PushCampaignAudience.Both,
        riderUrl: '/(main)/(shared)/Promotions',
        driverUrl: '/(main)/inbox/campaigns',
        createdBy: 'admin-id',
        status: 'queued',
      }),
    );
  });

  it('returns unique eligible user and device counts for an audience', async () => {
    users.aggregate.mockResolvedValue([
      { targetedUsers: 12, targetedDevices: 15 },
    ]);

    await expect(
      service.preview({ audience: PushCampaignAudience.Rider }),
    ).resolves.toEqual({ targetedUsers: 12, targetedDevices: 15 });

    expect(users.aggregate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          $match: expect.objectContaining({
            'preferences.marketingPushEnabled': { $ne: false },
          }),
        }),
      ]),
    );
  });

  it('sends a test only to the selected app devices', async () => {
    const select = jest.fn().mockResolvedValue({
      pushDevices: [
        { token: 'rider-token', platform: 'ios', app: 'rider' },
        { token: 'driver-token', platform: 'android', app: 'driver' },
      ],
    });
    users.findById.mockReturnValue({ select });
    push.dispatchToDevices.mockResolvedValue({
      targeted: 1,
      accepted: 1,
      failed: 0,
      invalidTokens: [],
    });

    await expect(
      service.sendTest({ id: 'admin-id' } as never, {
        audience: PushCampaignAudience.Driver,
        title: 'Driver bonus',
        body: 'Complete three trips today.',
        driverUrl: '/(main)/inbox/campaigns',
      }),
    ).resolves.toEqual({
      targetedUsers: 1,
      targetedDevices: 1,
      accepted: 1,
      failed: 0,
      invalidTokens: 0,
    });

    expect(push.dispatchToDevices).toHaveBeenCalledWith(
      [{ token: 'driver-token', platform: 'android', app: 'driver' }],
      expect.objectContaining({
        app: 'driver',
        title: '[TEST] Driver bonus',
        data: expect.objectContaining({
          type: 'Promotion',
          url: '/(main)/inbox/campaigns',
        }),
      }),
    );
  });
});
