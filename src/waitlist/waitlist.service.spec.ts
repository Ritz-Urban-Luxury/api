import { BadRequestException, HttpException } from '@nestjs/common';
import { WaitlistRole } from '../database/schemas/waitlist-entry.schema';
import { JoinWaitlistDTO, WaitlistAudience } from './dto/waitlist.dto';
import { WaitlistService } from './waitlist.service';

/** A mongoose query stand-in: chainable `.select()` that resolves to `value`. */
const query = <T>(value: T) => {
  const q = Promise.resolve(value) as Promise<T> & { select: jest.Mock };
  q.select = jest.fn().mockReturnValue(q);
  return q;
};

describe('WaitlistService', () => {
  const originalEnv = { ...process.env };
  const signup: JoinWaitlistDTO = {
    email: 'ada@example.com',
    name: 'Ada  Obi',
    role: WaitlistRole.Rider,
    source: 'home',
  };

  function setup({ cached }: { cached?: number } = {}) {
    const sendEmail = jest.fn().mockResolvedValue(undefined);
    const waitlistEntries = {
      findOne: jest.fn().mockReturnValue(query(null)),
      findOneAndUpdate: jest.fn().mockReturnValue(query(null)),
      create: jest.fn(async (doc) => ({ id: 'new', ...doc })),
      updateOne: jest.fn().mockResolvedValue(undefined),
      countDocuments: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue([]),
    };
    const cache = {
      get: jest.fn().mockResolvedValue(cached),
      set: jest.fn().mockResolvedValue(undefined),
    };
    const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const service = new WaitlistService(
      { waitlistEntries } as never,
      { sendEmail } as never,
      cache as never,
      logger as never,
    );
    service.sendInterval = 0;
    return { service, sendEmail, waitlistEntries, cache };
  }

  beforeEach(() => {
    delete process.env.RIDER_APP_STORE_URL;
    delete process.env.RIDER_PLAY_STORE_URL;
    delete process.env.DRIVER_APP_STORE_URL;
    delete process.env.DRIVER_PLAY_STORE_URL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('join', () => {
    it('adds a new person and sends the welcome email', async () => {
      const { service, waitlistEntries, sendEmail } = setup();

      await service.join(signup, '1.2.3.4');

      expect(waitlistEntries.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'ada@example.com',
          name: 'Ada Obi',
          role: 'rider',
          source: 'home',
          consentedAt: expect.any(Date),
          unsubscribeToken: expect.stringMatching(/^[a-f0-9]{48}$/),
        }),
      );
      expect(sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          template: 'waitlist-welcome.template.njk',
          recipient: { name: 'Ada Obi', email: 'ada@example.com' },
          context: expect.objectContaining({
            name: 'Ada',
            unsubscribeUrl: expect.stringMatching(
              /\/waitlist\/unsubscribe\?token=[a-f0-9]{48}$/,
            ),
          }),
        }),
      );
    });

    it('does not duplicate or re-email someone already on the list', async () => {
      const { service, waitlistEntries, sendEmail } = setup();
      waitlistEntries.findOne.mockReturnValue(
        query({ id: 'old', email: 'ada@example.com' }),
      );

      await service.join({ ...signup, role: WaitlistRole.Driver }, '1.2.3.4');

      expect(waitlistEntries.create).not.toHaveBeenCalled();
      expect(waitlistEntries.updateOne).toHaveBeenCalledWith(
        { _id: 'old' },
        { $set: { role: 'driver', name: 'Ada Obi' } },
      );
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('lets someone who unsubscribed join again', async () => {
      const { service, waitlistEntries, sendEmail } = setup();
      waitlistEntries.findOne.mockReturnValue(
        query({ id: 'old', unsubscribedAt: new Date() }),
      );
      waitlistEntries.findOneAndUpdate.mockReturnValue(
        query({
          id: 'old',
          email: 'ada@example.com',
          role: 'rider',
          unsubscribeToken: 'a'.repeat(48),
        }),
      );

      await service.join(signup, '1.2.3.4');

      expect(waitlistEntries.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: 'old' },
        expect.objectContaining({
          $unset: { unsubscribedAt: 1, notifiedAt: 1, notifyError: 1 },
        }),
        { new: true },
      );
      expect(sendEmail).toHaveBeenCalled();
    });

    it('keeps the sign-up when the welcome email fails', async () => {
      const { service, sendEmail, waitlistEntries } = setup();
      sendEmail.mockRejectedValue(new Error('provider down'));

      await expect(service.join(signup, '1.2.3.4')).resolves.toBeUndefined();
      expect(waitlistEntries.create).toHaveBeenCalled();
    });

    it('silently drops sign-ups that fill in the honeypot', async () => {
      const { service, waitlistEntries, sendEmail } = setup();

      await service.join({ ...signup, website: 'spam.example' }, '1.2.3.4');

      expect(waitlistEntries.create).not.toHaveBeenCalled();
      expect(sendEmail).not.toHaveBeenCalled();
    });

    it('rejects too many sign-ups from one address', async () => {
      const { service, waitlistEntries } = setup({ cached: 10 });

      await expect(service.join(signup, '1.2.3.4')).rejects.toBeInstanceOf(
        HttpException,
      );
      expect(waitlistEntries.create).not.toHaveBeenCalled();
    });
  });

  describe('unsubscribe', () => {
    it('marks the person as unsubscribed', async () => {
      const { service, waitlistEntries } = setup();
      waitlistEntries.findOne.mockResolvedValue({ id: 'old', role: 'rider' });

      await expect(service.unsubscribe('b'.repeat(48))).resolves.toBe(true);
      expect(waitlistEntries.updateOne).toHaveBeenCalledWith(
        { _id: 'old' },
        { $set: { unsubscribedAt: expect.any(Date) } },
      );
    });

    it('ignores malformed tokens without querying', async () => {
      const { service, waitlistEntries } = setup();

      await expect(service.unsubscribe('{"$ne":null}')).resolves.toBe(false);
      expect(waitlistEntries.findOne).not.toHaveBeenCalled();
    });
  });

  describe('sendLaunch', () => {
    it('refuses to send before the store link is set', async () => {
      const { service } = setup();

      await expect(
        service.sendLaunch(WaitlistAudience.Rider),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('emails each pending person once and releases failures for a retry', async () => {
      process.env.RIDER_PLAY_STORE_URL =
        'https://play.google.com/store/apps/details?id=com.ritz.rider';
      const { service, waitlistEntries, sendEmail } = setup();
      const people = [
        {
          id: '1',
          email: 'a@example.com',
          role: 'rider',
          unsubscribeToken: 't1',
        },
        {
          id: '2',
          email: 'b@example.com',
          role: 'rider',
          unsubscribeToken: 't2',
        },
      ];
      waitlistEntries.countDocuments.mockResolvedValue(2);
      waitlistEntries.findOneAndUpdate
        .mockReturnValueOnce(query(people[0]))
        .mockReturnValueOnce(query(people[1]))
        .mockReturnValue(query(null));
      sendEmail
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('bounced'));

      await expect(service.sendLaunch(WaitlistAudience.Rider)).resolves.toEqual(
        { queued: 2 },
      );
      await new Promise((resolve) => {
        setTimeout(resolve, 20);
      });

      expect(sendEmail).toHaveBeenCalledTimes(2);
      expect(sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          template: 'waitlist-launch.template.njk',
          recipient: 'a@example.com',
          context: expect.objectContaining({
            playStoreUrl:
              'https://play.google.com/store/apps/details?id=com.ritz.rider',
          }),
        }),
      );
      // Each claim only picks people not yet notified, and skips this run's failures.
      expect(waitlistEntries.findOneAndUpdate).toHaveBeenLastCalledWith(
        expect.objectContaining({
          role: { $in: ['rider'] },
          notifiedAt: null,
          unsubscribedAt: null,
          $or: expect.any(Array),
          _id: { $nin: ['2'] },
        }),
        expect.anything(),
        expect.anything(),
      );
      expect(waitlistEntries.updateOne).toHaveBeenCalledWith(
        { _id: '2', notifyClaimedAt: expect.any(Date) },
        { $unset: { notifyClaimedAt: 1 }, $set: { notifyError: 'bounced' } },
      );
    });

    it('does not treat the website URL as an app-store link', async () => {
      process.env.RIDER_APP_STORE_URL = 'https://www.ritzurbanluxury.com/';
      const { service } = setup();

      await expect(service.sendLaunch(WaitlistAudience.Rider)).rejects.toThrow(
        'Add the App Store or Google Play link for Ritz',
      );
    });
  });

  describe('summary', () => {
    it('reports which sources sign-ups came from, biggest first', async () => {
      const { service, waitlistEntries } = setup();
      waitlistEntries.aggregate
        .mockResolvedValueOnce([
          { _id: 'rider', total: 5, notified: 0, unsubscribed: 1 },
        ])
        .mockResolvedValueOnce([
          { _id: 'waitlist-instagram-launch', total: 4, riders: 3, drivers: 1 },
          { _id: null, total: 1, riders: 1, drivers: 0 },
        ]);

      const summary = await service.summary();

      expect(summary.rider).toEqual({
        total: 5,
        notified: 0,
        unsubscribed: 1,
        pending: 4,
      });
      expect(summary.sources).toEqual([
        {
          source: 'waitlist-instagram-launch',
          total: 4,
          riders: 3,
          drivers: 1,
        },
        { source: 'unknown', total: 1, riders: 1, drivers: 0 },
      ]);
    });
  });

  describe('sendTest', () => {
    it('sends a preview to the admin before the store links are set', async () => {
      const { service, sendEmail } = setup();

      await expect(
        service.sendTest('admin@ritz.com', WaitlistAudience.Rider),
      ).resolves.toEqual({
        sentTo: 'admin@ritz.com',
        emails: 1,
        withoutLinks: ['Ritz'],
      });
      expect(sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          recipient: 'admin@ritz.com',
          subject: expect.stringMatching(/^\[TEST\]/),
          context: expect.objectContaining({
            previewWithoutLinks: true,
            appStoreUrl: expect.stringMatching(/\/download$/),
          }),
        }),
      );
    });

    it('uses the real store link once it is set', async () => {
      process.env.DRIVER_PLAY_STORE_URL =
        'https://play.google.com/store/apps/details?id=com.ritz.driver';
      const { service, sendEmail } = setup();

      await expect(
        service.sendTest('admin@ritz.com', WaitlistAudience.Driver),
      ).resolves.toMatchObject({ withoutLinks: [] });
      const { context } = sendEmail.mock.calls[0][0];
      expect(context.playStoreUrl).toBe(
        'https://play.google.com/store/apps/details?id=com.ritz.driver',
      );
      expect(context.previewWithoutLinks).toBeUndefined();
    });

    it('still refuses the real launch email without store links', async () => {
      const { service, sendEmail } = setup();

      await expect(
        service.sendLaunch(WaitlistAudience.Rider),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(sendEmail).not.toHaveBeenCalled();
    });
  });
});
