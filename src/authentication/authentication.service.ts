import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as moment from 'moment';
import { Logger } from 'src/logger/logger.service';
import { NotificationService } from 'src/notification';
import { DB_TABLES } from 'src/shared/constants';
import { Model } from 'src/shared/types';
import { Util } from 'src/shared/util';
import { RequestEmailOTPDTO, RequestPhoneOTPDTO } from './authentication.dto';
import { AuthTokenDocument } from './schemas';

@Injectable()
export class AuthenticationService {
  constructor(
    @InjectModel(DB_TABLES.AUTH_TOKENS)
    private readonly authTokenModel: Model<AuthTokenDocument>,
    private readonly notificationService: NotificationService,
    private readonly logger: Logger,
  ) {}

  async requestPhoneOtp(payload: RequestPhoneOTPDTO) {
    const { phoneNumber } = payload;
    const phone = Util.formatPhoneNumber(phoneNumber, 'NG');
    const previousAuthToken = await this.authTokenModel.findOne({
      'meta.type': 'phone-otp',
      'meta.phoneNumber': phone,
      createdAt: {
        $gte: moment().subtract(100, 'seconds').toDate(),
      },
    });
    if (!previousAuthToken) {
      const token = Math.random().toString().substring(2, 6);

      await this.authTokenModel.create({
        expiresAt: moment().add(1, 'minute').toDate(),
        token,
        meta: {
          phoneNumber: phone,
          type: 'phone-otp',
        },
      });

      this.notificationService
        .sendSMS({
          to: phone,
          sms: `Your verification code is: ${token}`,
        })
        .catch((error) => {
          this.logger.error(`error sending phone otp sms - ${error.message}`);
        });
    }
  }

  async requestEmailOtp(payload: RequestEmailOTPDTO) {
    const { email, name } = payload;
    const previousAuthToken = await this.authTokenModel.findOne({
      'meta.type': 'email-otp',
      'meta.email': email,
      createdAt: {
        $gte: moment().subtract(100, 'seconds').toDate(),
      },
    });
    if (!previousAuthToken) {
      const token = Math.random().toString().substring(2, 6);

      await this.authTokenModel.create({
        expiresAt: moment().add(1, 'minute').toDate(),
        token,
        meta: {
          email,
          type: 'email-otp',
        },
      });

      this.notificationService
        .sendEmail({
          recipient: { email, name },
          context: { otp: token },
          subject: 'Verify your email',
          template: 'email-otp.template.njk',
        })
        .catch((error) => {
          this.logger.error(
            `error sending email otp message - ${error.message}`,
          );
        });
    }
  }
}
