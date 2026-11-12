import * as Path from 'path';
import { configure } from 'nunjucks';
import { DriverReviewStatus } from '../database/schemas/user.schema';
import { UserService } from './user.service';

describe('UserService.createDriver', () => {
  const payload = {
    email: 'Driver@Example.com',
    firstName: ' Ada ',
    lastName: 'Obi',
    phoneNumber: '08031234567',
  };

  const setup = () => {
    const create = jest.fn(async (doc) => ({ id: 'driver-1', ...doc }));
    const db = {
      users: {
        create,
        findOne: jest.fn().mockResolvedValue(null),
        updateOne: jest.fn().mockResolvedValue(undefined),
      },
    };
    const notifications = { sendEmail: jest.fn().mockResolvedValue(undefined) };
    const service = new UserService(
      db as never,
      {} as never,
      {} as never,
      notifications as never,
    );
    return { create, notifications, service };
  };

  it('creates an unverified driver that still needs review by default', async () => {
    const { create, service } = setup();

    await service.createDriver(payload as never, { id: 'admin-1' } as never);

    const doc = create.mock.calls[0][0];
    expect(doc).toEqual(
      expect.objectContaining({
        isDriver: true,
        isVerified: false,
        mustChangePassword: true,
      }),
    );
    expect(doc.isInHouseDriver).toBeUndefined();
    expect(doc.driverReviewStatus).toBeUndefined();
  });

  it('gives the account a hidden random password when the admin sets none', async () => {
    const { create, service } = setup();

    await service.createDriver(payload as never);
    await service.createDriver({
      ...payload,
      email: 'second@example.com',
    } as never);

    const [first, second] = create.mock.calls.map(([doc]) => doc.password);
    expect(first).toEqual(expect.any(String));
    expect(first.length).toBeGreaterThanOrEqual(24);
    expect(first).not.toBe(second);
  });

  it('registers an approved in-house driver when requested', async () => {
    const { create, service } = setup();

    await service.createDriver(
      { ...payload, inHouse: true } as never,
      { id: 'admin-1' } as never,
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        driverReviewStatus: DriverReviewStatus.Approved,
        driverReviewedBy: 'admin-1',
        isDriver: true,
        isInHouseDriver: true,
        isVerified: true,
      }),
    );
  });

  it('emails sign-in instructions without any password', async () => {
    const { notifications, service } = setup();

    await service.createDriver({ ...payload, inHouse: true } as never);
    await new Promise((resolve) => {
      setImmediate(resolve);
    });

    expect(notifications.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: { email: 'driver@example.com', name: 'Ada' },
        subject: 'Your Ritz driver account is ready',
        template: 'driver-welcome.template.njk',
        context: expect.objectContaining({ inHouse: true }),
      }),
    );
    const { context } = notifications.sendEmail.mock.calls[0][0];
    expect(JSON.stringify(context)).not.toMatch(/password/i);
  });

  it('still creates the driver when the welcome email fails', async () => {
    const { notifications, service } = setup();
    notifications.sendEmail.mockRejectedValue(new Error('provider down'));

    await expect(service.createDriver(payload as never)).resolves.toEqual(
      expect.objectContaining({ id: 'driver-1' }),
    );
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
  });
});

describe('UserService.resendDriverWelcomeEmail', () => {
  const setup = (driver: Record<string, unknown> | null) => {
    const db = {
      users: {
        findOne: jest.fn().mockResolvedValue(driver),
        updateOne: jest.fn().mockResolvedValue(undefined),
      },
    };
    const notifications = { sendEmail: jest.fn().mockResolvedValue(undefined) };
    const service = new UserService(
      db as never,
      {} as never,
      {} as never,
      notifications as never,
    );
    return { db, notifications, service };
  };

  const pendingDriver = {
    email: 'ada@example.com',
    firstName: 'Ada',
    id: 'driver-1',
    isDriver: true,
    isInHouseDriver: true,
    mustChangePassword: true,
  };

  it('resends the welcome email and records when it was sent', async () => {
    const { db, notifications, service } = setup(pendingDriver);

    const result = await service.resendDriverWelcomeEmail('driver-1');

    expect(notifications.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ inHouse: true }),
        template: 'driver-welcome.template.njk',
      }),
    );
    expect(db.users.updateOne).toHaveBeenCalledWith(
      { _id: 'driver-1' },
      { $set: { driverWelcomeEmailSentAt: expect.any(Date) } },
    );
    expect(result).toEqual({
      email: 'ada@example.com',
      sentAt: expect.any(Date),
    });
  });

  it('refuses once the driver has set their own password', async () => {
    const { notifications, service } = setup({
      ...pendingDriver,
      mustChangePassword: false,
    });

    await expect(service.resendDriverWelcomeEmail('driver-1')).rejects.toThrow(
      'already signed in',
    );
    expect(notifications.sendEmail).not.toHaveBeenCalled();
  });

  it('asks the admin to wait if an email was sent in the last minute', async () => {
    const { notifications, service } = setup({
      ...pendingDriver,
      driverWelcomeEmailSentAt: new Date(Date.now() - 10_000),
    });

    await expect(service.resendDriverWelcomeEmail('driver-1')).rejects.toThrow(
      'wait a minute',
    );
    expect(notifications.sendEmail).not.toHaveBeenCalled();
  });

  it('reports a delivery failure to the admin', async () => {
    const { db, notifications, service } = setup(pendingDriver);
    notifications.sendEmail.mockRejectedValue(new Error('provider down'));

    await expect(service.resendDriverWelcomeEmail('driver-1')).rejects.toThrow(
      "Couldn't send the email",
    );
    expect(db.users.updateOne).not.toHaveBeenCalled();
  });

  it('returns not found for unknown drivers', async () => {
    const { service } = setup(null);

    await expect(service.resendDriverWelcomeEmail('missing')).rejects.toThrow(
      'driver not found',
    );
  });
});

describe('driver welcome email template', () => {
  const engine = configure(Path.join(__dirname, '../../templates'), {
    autoescape: true,
  });

  it('explains how an in-house driver signs in and skips the car', () => {
    const html = engine.render('driver-welcome.template.njk', {
      email: 'ada@example.com',
      inHouse: true,
      name: 'Ada',
      phoneNumber: '+2348031234567',
      supportEmail: 'support@ritzurbanluxury.com',
    });

    expect(html).toContain('Welcome to Ritz, Ada.');
    expect(html).toContain('in-house driver account');
    expect(html).toContain('ada@example.com');
    expect(html).toContain('one-time code');
    expect(html).toContain("You don't need to add a car");
  });

  it('omits in-house wording for a regular driver', () => {
    const html = engine.render('driver-welcome.template.njk', {
      email: 'ada@example.com',
      inHouse: false,
      supportEmail: 'support@ritzurbanluxury.com',
    });

    expect(html).not.toContain('in-house');
    expect(html).not.toContain("You don't need to add a car");
  });
});
