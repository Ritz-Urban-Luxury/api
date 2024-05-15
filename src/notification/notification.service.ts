import { Injectable } from '@nestjs/common';
import * as SendGrid from '@sendgrid/mail';
import { configure, Environment } from 'nunjucks';
import * as Path from 'path';
import { Logger } from 'src/logger/logger.service';
import config from '../shared/config';
import { Http } from '../shared/http';
import { EmailPayload, SMSPayload } from './types';

@Injectable()
export class NotificationService {
  private templateEngine: Environment;

  private client: typeof SendGrid = SendGrid;

  constructor(private readonly logger: Logger) {}

  onModuleInit(): void {
    const { sendGrid } = config();
    const path = Path.join(__dirname, '../../', 'templates');

    this.templateEngine = configure(path, { autoescape: true });
    this.client.setApiKey(sendGrid.apiKey);

    this.sendSMS({ to: '2348162452124', sms: 'rul running and can send sms' })
      .then(console.log)
      .catch(console.debug);
  }

  sendSMS(payload: SMSPayload) {
    this.logger.log('new sms', payload);
    const { termii, turnOffSMS } = config();

    const channel = ['OTPAlert', 'N-Alert'].includes(payload.from)
      ? 'dnd'
      : 'generic';

    if (channel === 'dnd' || turnOffSMS) {
      return Http.request({
        method: 'POST',
        baseURL: 'https://api.bento.africa',
        url: '/notifications/sms',
        data: {
          sender: 'N-Alert',
          recipient: payload.to,
          message: payload.sms,
        },
      });
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
    const { sendGrid } = config();
    const { recipient, context, subject, template } = payload;

    return this.client.send({
      to: recipient,
      from: sendGrid.from,
      subject,
      html: this.templateEngine.render(template, context),
    });
  }
}
