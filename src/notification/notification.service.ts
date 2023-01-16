import { Injectable } from '@nestjs/common';
import config from 'src/shared/config';
import { Http } from 'src/shared/http';
import { SMSPayload } from './types';

@Injectable()
export class NotificationService {
  sendSMS(payload: SMSPayload) {
    const { termii } = config();

    return Http.request({
      method: 'POST',
      url: termii.url,
      data: {
        from: termii.from,
        ...payload,
        api_key: termii.key,
        channel: ['OTPAlert', 'N-Alert'].includes(payload.from)
          ? 'dnd'
          : 'generic',
        type: 'plain',
      },
    });
  }
}
