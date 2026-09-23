import { Http } from '../shared/http';
import { NotificationService } from './notification.service';

describe('NotificationService SMS routing', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.TERMII_API_KEY = 'test-key';
    process.env.TERMII_API_URL = 'https://example.termii.test';
    process.env.TERMII_FROM = 'Ritz Luxury';
    process.env.TERMII_DND_FROM = 'OE Alert';
    delete process.env.TURN_OFF_SMS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it('passes an explicit DND route to Termii for transactional messages', async () => {
    const request = jest.spyOn(Http, 'request').mockResolvedValue({} as never);
    const service = new NotificationService({ log: jest.fn() } as never);

    await service.sendSMS({
      channel: 'dnd',
      sms: 'Your verification code is 1234',
      to: '2348011112222',
    });

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          channel: 'dnd',
          from: 'OE Alert',
          to: '2348011112222',
        }),
      }),
    );
  });

  it('keeps the branded sender for generic messages', async () => {
    const request = jest.spyOn(Http, 'request').mockResolvedValue({} as never);
    const service = new NotificationService({ log: jest.fn() } as never);

    await service.sendSMS({
      sms: 'A promotional message',
      to: '2348011112222',
    });

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          channel: 'generic',
          from: 'Ritz Luxury',
        }),
      }),
    );
  });
});
