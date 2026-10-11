import { HttpException } from '@nestjs/common';
import { ContactService } from './contact.service';
import { ContactMessageDTO, ContactTopic } from './dto/contact-message.dto';

describe('ContactService', () => {
  const originalEnv = { ...process.env };
  const message: ContactMessageDTO = {
    name: 'Ada  Obi\nBcc: someone',
    email: 'ada@example.com',
    topic: ContactTopic.Driver,
    message: 'I would like to drive with Ritz.',
  };

  function setup(cached?: number) {
    const sendEmail = jest.fn().mockResolvedValue(undefined);
    const cache = {
      get: jest.fn().mockResolvedValue(cached),
      set: jest.fn().mockResolvedValue(undefined),
    };
    const logger = { log: jest.fn(), warn: jest.fn() };
    const service = new ContactService(
      { sendEmail } as never,
      cache as never,
      logger as never,
    );
    return { service, sendEmail, cache };
  }

  beforeEach(() => {
    delete process.env.CONTACT_SUPPORT_EMAIL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('emails the support inbox with the sender as reply-to', async () => {
    const { service, sendEmail } = setup();

    await service.send(message, '1.2.3.4');

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: 'support@ritzurbanluxury.com',
        replyTo: { name: 'Ada Obi Bcc: someone', email: 'ada@example.com' },
        subject: 'Website message: Driving with Ritz from Ada Obi Bcc: someone',
        template: 'contact-message.template.njk',
      }),
    );
  });

  it('uses CONTACT_SUPPORT_EMAIL when set', async () => {
    process.env.CONTACT_SUPPORT_EMAIL = 'help@ritzurbanluxury.com';
    const { service, sendEmail } = setup();

    await service.send(message, '1.2.3.4');

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: 'help@ritzurbanluxury.com' }),
    );
  });

  it('silently drops messages that fill in the honeypot', async () => {
    const { service, sendEmail } = setup();

    await service.send({ ...message, website: 'spam.example' }, '1.2.3.4');

    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('rejects senders over the hourly limit', async () => {
    const { service, sendEmail } = setup(5);

    await expect(service.send(message, '1.2.3.4')).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('counts each message against the sender', async () => {
    const { service, cache } = setup(2);

    await service.send(message, '1.2.3.4');

    expect(cache.set).toHaveBeenCalledWith(
      'contact-form:1.2.3.4',
      3,
      60 * 60 * 1000,
    );
  });
});
