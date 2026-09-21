import axios from 'axios';
import { PushNotificationService } from './push-notification.service';

jest.mock('axios');

const mockedAxios = jest.mocked(axios);

describe('PushNotificationService', () => {
  const users = {
    findById: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(),
  };
  const logger = {
    error: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
  };

  let service: PushNotificationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PushNotificationService({ users } as never, logger as never);
  });

  const send = async (
    pushDevices: Array<{
      token: string;
      platform: 'ios' | 'android';
      app: 'rider' | 'driver';
    }>,
  ) => {
    await (
      service as unknown as {
        sendToUserAsync: (user: unknown, payload: unknown) => Promise<void>;
      }
    ).sendToUserAsync(
      { id: 'user-id', pushDevices },
      {
        app: 'rider',
        title: 'Driver assigned',
        body: 'Your driver is on the way',
        data: { tripId: 'trip-id' },
      },
    );
  };

  it('sends Expo push tokens through the Expo Push Service', async () => {
    mockedAxios.post.mockResolvedValue({
      data: { data: [{ status: 'ok', id: 'ticket-id' }] },
    });

    await send([
      {
        token: 'ExpoPushToken[ios-token]',
        platform: 'ios',
        app: 'rider',
      },
    ]);

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://exp.host/--/api/v2/push/send',
      [
        expect.objectContaining({
          to: 'ExpoPushToken[ios-token]',
          title: 'Driver assigned',
          body: 'Your driver is on the way',
          data: { tripId: 'trip-id' },
          sound: 'default',
        }),
      ],
      expect.objectContaining({ headers: expect.any(Object) }),
    );
    expect(users.updateOne).not.toHaveBeenCalled();
  });

  it('removes Expo tokens reported as no longer registered', async () => {
    mockedAxios.post.mockResolvedValue({
      data: {
        data: [
          {
            status: 'error',
            message: 'Device is not registered',
            details: { error: 'DeviceNotRegistered' },
          },
        ],
      },
    });

    await send([
      {
        token: 'ExponentPushToken[expired-token]',
        platform: 'ios',
        app: 'rider',
      },
    ]);

    expect(users.updateOne).toHaveBeenCalledWith(
      { _id: 'user-id' },
      {
        $pull: {
          pushDevices: {
            token: { $in: ['ExponentPushToken[expired-token]'] },
          },
        },
      },
    );
  });

  it('keeps native Android tokens on Firebase during migration', async () => {
    const sendEachForMulticast = jest.fn().mockResolvedValue({
      responses: [{ success: true }],
    });
    (
      service as unknown as {
        messaging: { sendEachForMulticast: typeof sendEachForMulticast };
      }
    ).messaging = { sendEachForMulticast };

    await send([
      {
        token: 'native-fcm-token',
        platform: 'android',
        app: 'rider',
      },
    ]);

    expect(sendEachForMulticast).toHaveBeenCalledWith(
      expect.objectContaining({
        tokens: ['native-fcm-token'],
      }),
    );
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('still sends Android notifications when the Expo provider fails', async () => {
    mockedAxios.post.mockRejectedValue(new Error('Expo unavailable'));
    const sendEachForMulticast = jest.fn().mockResolvedValue({
      responses: [{ success: true }],
    });
    (
      service as unknown as {
        messaging: { sendEachForMulticast: typeof sendEachForMulticast };
      }
    ).messaging = { sendEachForMulticast };

    await send([
      {
        token: 'ExpoPushToken[ios-token]',
        platform: 'ios',
        app: 'rider',
      },
      {
        token: 'native-fcm-token',
        platform: 'android',
        app: 'rider',
      },
    ]);

    expect(sendEachForMulticast).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      'Expo push send failed: Expo unavailable',
    );
  });

  it('skips old raw APNs tokens and explains that the app must re-register', async () => {
    await send([
      {
        token: 'raw-apns-token',
        platform: 'ios',
        app: 'rider',
      },
    ]);

    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('device must open the updated app'),
    );
  });
});
