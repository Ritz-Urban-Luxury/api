import { BadRequestException, HttpException } from '@nestjs/common';
import {
  SupportComplaintSource,
  SupportComplaintStatus,
} from '../database/schemas/support-complaint.schema';
import { SupportService } from './support.service';

describe('SupportService', () => {
  const originalEnv = { ...process.env };
  const rider = { id: 'user-1', firstName: 'Ada', lastName: 'Rider\nBcc: x' };

  function setup({
    cached,
    trip = { id: 'trip-db-1' },
    emailFails = false,
  }: {
    cached?: number;
    trip?: { id: string } | null;
    emailFails?: boolean;
  } = {}) {
    const sendEmail = emailFails
      ? jest.fn().mockRejectedValue(new Error('smtp down'))
      : jest.fn().mockResolvedValue(undefined);
    const create = jest.fn(async (doc: Record<string, unknown>) => ({
      ...doc,
      id: 'complaint-1',
      status: SupportComplaintStatus.Open,
    }));
    const select = jest.fn().mockResolvedValue(trip);
    const db = {
      supportComplaints: { create, paginate: jest.fn() },
      trips: { findOne: jest.fn(() => ({ select })) },
      findAndUpdateOrFail: jest.fn().mockResolvedValue({ id: 'complaint-1' }),
    };
    const cache = {
      get: jest.fn().mockResolvedValue(cached),
      set: jest.fn().mockResolvedValue(undefined),
    };
    const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const service = new SupportService(
      db as never,
      { sendEmail } as never,
      cache as never,
      logger as never,
    );
    return { service, db, sendEmail, logger };
  }

  beforeEach(() => {
    delete process.env.CONTACT_SUPPORT_EMAIL;
    delete process.env.ADMIN_APP_URL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns the configured support email', () => {
    process.env.CONTACT_SUPPORT_EMAIL = 'help@ritzurbanluxury.com';
    expect(setup().service.getContact()).toEqual({
      email: 'help@ritzurbanluxury.com',
    });
  });

  it('saves the complaint linked to the rider and their own trip', async () => {
    const tripId = '64b7f0c2a1b2c3d4e5f60718';
    const { service, db } = setup();

    const result = await service.createComplaint(rider as never, {
      email: 'ada@example.com',
      message: 'The driver shouted at me during the ride.',
      issue: 'My driver was rude',
      tripId,
    });

    expect(db.trips.findOne).toHaveBeenCalledWith({
      _id: tripId,
      user: 'user-1',
    });
    expect(db.supportComplaints.create).toHaveBeenCalledWith(
      expect.objectContaining({
        user: 'user-1',
        email: 'ada@example.com',
        name: 'Ada Rider Bcc: x',
        source: SupportComplaintSource.RideHelp,
        issue: 'My driver was rude',
        trip: 'trip-db-1',
        tripReference: tripId,
        safetyRelated: false,
      }),
    );
    expect(result).toEqual({ id: 'complaint-1', status: 'Open' });
  });

  it("keeps the reference but does not link a trip that is not the rider's", async () => {
    const { service, db } = setup({ trip: null });

    await service.createComplaint(rider as never, {
      email: 'ada@example.com',
      message: 'Something went wrong with this trip.',
      tripId: '64b7f0c2a1b2c3d4e5f60718',
    });

    expect(db.supportComplaints.create).toHaveBeenCalledWith(
      expect.objectContaining({
        trip: undefined,
        tripReference: '64b7f0c2a1b2c3d4e5f60718',
      }),
    );
  });

  it('flags unsafe ride issues as safety-related and marks the email subject', async () => {
    const { service, db, sendEmail } = setup();

    await service.createComplaint(rider as never, {
      email: 'ada@example.com',
      message: 'The driver drove dangerously the whole way.',
      issue: 'I felt unsafe using RUL',
    });

    expect(db.supportComplaints.create).toHaveBeenCalledWith(
      expect.objectContaining({ safetyRelated: true, source: 'support' }),
    );
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: 'support@ritzurbanluxury.com',
        replyTo: { name: 'Ada Rider Bcc: x', email: 'ada@example.com' },
        subject: '[Safety] App complaint: I felt unsafe using RUL',
        template: 'support-complaint.template.njk',
      }),
    );
  });

  it('links to the admin app when ADMIN_APP_URL is set', async () => {
    process.env.ADMIN_APP_URL = 'https://admin.example.com/';
    const { service, sendEmail } = setup();

    await service.createComplaint(rider as never, {
      email: 'ada@example.com',
      message: 'I was charged twice for one trip.',
      topic: 'Payment',
    });

    expect(sendEmail.mock.calls[0][0].context.adminUrl).toBe(
      'https://admin.example.com/document/complaints?tab=support&complaint=complaint-1',
    );
    expect(sendEmail.mock.calls[0][0].subject).toBe('App complaint: Payment');
  });

  it('still saves the complaint when the email fails', async () => {
    const { service, db, logger } = setup({ emailFails: true });

    await expect(
      service.createComplaint(rider as never, {
        email: 'ada@example.com',
        message: 'Nobody has replied to my last message.',
      }),
    ).resolves.toEqual({ id: 'complaint-1', status: 'Open' });
    expect(db.supportComplaints.create).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it('rate limits per rider', async () => {
    const { service, db } = setup({ cached: 5 });

    await expect(
      service.createComplaint(rider as never, {
        email: 'ada@example.com',
        message: 'Another complaint about the same thing.',
      }),
    ).rejects.toBeInstanceOf(HttpException);
    expect(db.supportComplaints.create).not.toHaveBeenCalled();
  });

  it('records who closed a complaint and when', async () => {
    const { service, db } = setup();

    await service.updateComplaint(
      '64b7f0c2a1b2c3d4e5f60719',
      { status: SupportComplaintStatus.Resolved, adminNote: 'Refunded' },
      { id: 'admin-1' } as never,
    );

    const [, , update] = db.findAndUpdateOrFail.mock.calls[0];
    expect(update.$set).toEqual(
      expect.objectContaining({
        status: 'Resolved',
        adminNote: 'Refunded',
        handledBy: 'admin-1',
        resolvedAt: expect.any(Date),
      }),
    );
  });

  it('rejects an invalid complaint id', async () => {
    await expect(
      setup().service.updateComplaint(
        'nope',
        { status: SupportComplaintStatus.Reviewing },
        { id: 'admin-1' } as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
