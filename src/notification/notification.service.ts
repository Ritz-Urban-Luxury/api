import { Injectable } from '@nestjs/common';
import * as SendGrid from '@sendgrid/mail';
import { configure, Environment } from 'nunjucks';
import * as Path from 'path';
import config from 'src/shared/config';
import { Http } from 'src/shared/http';
import { EmailPayload, SMSPayload } from './types';

@Injectable()
export class NotificationService {
  private templateEngine: Environment;

  private client: typeof SendGrid = SendGrid;

  onModuleInit(): void {
    const { sendGrid } = config();
    const path = Path.join(__dirname, '../../', 'templates');

    this.templateEngine = configure(path, { autoescape: true });
    this.client.setApiKey(sendGrid.apiKey);
  }

  sendSMS(payload: SMSPayload) {
    const { termii } = config();

    return Http.request({
      method: 'POST',
      url: termii.url,
      data: {
        ...payload,
        from: termii.from,
        api_key: termii.key,
        channel: ['OTPAlert', 'N-Alert'].includes(payload.from)
          ? 'dnd'
          : 'generic',
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
