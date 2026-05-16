import { Injectable } from '@nestjs/common';
import * as SendGrid from '@sendgrid/mail';
import { configure, Environment } from 'nunjucks';
import * as Path from 'path';
import { Resend } from 'resend';
import { Logger } from 'src/logger/logger.service';
import config from '../shared/config';
import { Http } from '../shared/http';
import { EmailPayload, SMSPayload } from './types';

@Injectable()
export class NotificationService {
  private templateEngine: Environment;

  private client: typeof SendGrid = SendGrid;

  private resend: Resend;

  private emailProvider: 'resend' | 'sendgrid';

  constructor(private readonly logger: Logger) {}

  onModuleInit(): void {
    const { email, resend, sendGrid } = config();
    const path = Path.join(__dirname, '../../', 'templates');

    this.templateEngine = configure(path, { autoescape: true });

    const provider = email.provider as 'resend' | 'sendgrid';
    if (provider !== 'resend' && provider !== 'sendgrid') {
      throw new Error(
        `Invalid EMAIL_PROVIDER "${email.provider}". Must be "resend" or "sendgrid".`,
      );
    }

    this.emailProvider = provider;
    if (this.emailProvider === 'resend') {
      if (!resend.apiKey) {
        throw new Error(
          'RESEND_API_KEY is required when EMAIL_PROVIDER is resend',
        );
      }
      if (!resend.from) {
        throw new Error(
          'RESEND_DEFAULT_FROM is required when EMAIL_PROVIDER is resend',
        );
      }
      this.resend = new Resend(resend.apiKey);
      return;
    }

    if (!sendGrid.apiKey) {
      throw new Error(
        'SENDGRID_API_KEY is required when EMAIL_PROVIDER is sendgrid',
      );
    }
    this.client.setApiKey(sendGrid.apiKey);
  }

  sendSMS(payload: SMSPayload) {
    this.logger.log('new sms', payload);
    const { termii, turnOffSMS } = config();

    const channel = ['OTPAlert', 'N-Alert'].includes(payload.from)
      ? 'dnd'
      : 'generic';
    if (turnOffSMS) {
      return null;
    }

    return Http.request({
      method: 'POST',
      baseURL: termii.url,
      url: '/api/sms/send',
      data: {
        from: termii.from,
        ...payload,
        api_key: termii.key,
        channel,
        type: 'plain',
      },
    });
  }

  sendEmail(payload: EmailPayload) {
    const { recipient, context, subject, template } = payload;
    const html = this.templateEngine.render(template, context);

    if (this.emailProvider === 'resend') {
      const { resend } = config();
      return this.resend.emails
        .send({
          from: resend.from,
          to: this.normalizeRecipients(recipient),
          subject,
          html,
        })
        .then(({ error }) => {
          if (error) {
            throw error;
          }
        });
    }

    const { sendGrid } = config();
    return this.client.send({
      to: recipient,
      from: sendGrid.from,
      subject,
      html,
    });
  }

  private normalizeRecipients(recipient: EmailPayload['recipient']): string[] {
    if (typeof recipient === 'string') {
      return [recipient];
    }
    return [recipient.email];
  }
}
