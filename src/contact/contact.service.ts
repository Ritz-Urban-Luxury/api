import { CACHE_MANAGER, Inject, Injectable } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { Logger } from '../logger/logger.service';
import { NotificationService } from '../notification/notification.service';
import config from '../shared/config';
import { enforceRateLimit } from '../shared/rate-limit';
import { ContactMessageDTO, ContactTopic } from './dto/contact-message.dto';

const MAX_MESSAGES_PER_WINDOW = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

const topicLabels: Record<ContactTopic, string> = {
  [ContactTopic.General]: 'General enquiry',
  [ContactTopic.Rider]: 'Rider trip',
  [ContactTopic.Driver]: 'Driving with Ritz',
  [ContactTopic.Fleet]: 'Fleet partnership',
};

@Injectable()
export class ContactService {
  constructor(
    private readonly notifications: NotificationService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly logger: Logger,
  ) {}

  /** Emails a website contact message to the support inbox, with the sender as reply-to. */
  async send(payload: ContactMessageDTO, ip: string): Promise<void> {
    if (payload.website) {
      // Pretend it worked so bots do not learn to skip the honeypot.
      this.logger.warn('Contact form honeypot triggered', { ip });
      return;
    }

    await enforceRateLimit(this.cache, this.logger, {
      key: `contact-form:${ip}`,
      max: MAX_MESSAGES_PER_WINDOW,
      windowMs: RATE_LIMIT_WINDOW_MS,
      message:
        'Too many messages. Please try again later or email us directly.',
    });

    const { contact } = config();
    const topic = topicLabels[payload.topic];
    // Collapse whitespace so a name cannot inject extra header lines into the subject.
    const name = payload.name.replace(/\s+/g, ' ');

    await this.notifications.sendEmail({
      template: 'contact-message.template.njk',
      recipient: contact.supportEmail,
      replyTo: { name, email: payload.email },
      subject: `Website message: ${topic} from ${name}`,
      context: {
        name,
        email: payload.email,
        topic,
        message: payload.message,
        sentAt: new Date().toUTCString(),
      },
    });

    this.logger.log('Contact form message sent', { topic: payload.topic });
  }
}
