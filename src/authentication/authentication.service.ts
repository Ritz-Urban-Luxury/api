import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { hash } from 'bcryptjs';
import * as Crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import * as moment from 'moment';
import { Logger } from 'src/logger/logger.service';
import { NotificationService } from 'src/notification';
import config from 'src/shared/config';
import { DB_TABLES } from 'src/shared/constants';
import { Http } from 'src/shared/http';
import { Model } from 'src/shared/types';
import { Util } from 'src/shared/util';
import { OAuthProvider, UserDocument, UserService } from 'src/user';
import {
  RequestEmailOTPDTO,
  RequestPhoneOTPDTO,
  SignupDTO,
} from './authentication.dto';
import { AuthTokenDocument } from './schemas';

@Injectable()
export class AuthenticationService {
  private readonly googleOAuthClient: OAuth2Client;

  constructor(
    @InjectModel(DB_TABLES.AUTH_TOKENS)
    private readonly authTokenModel: Model<AuthTokenDocument>,
    private readonly notificationService: NotificationService,
    private readonly logger: Logger,
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
  ) {
    this.googleOAuthClient = new OAuth2Client();
  }

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
        expiresAt: moment().add(10, 'minute').toDate(),
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
    const { email: _email, name } = payload;
    const email = _email.toLowerCase();
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
        expiresAt: moment().add(10, 'minute').toDate(),
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

  async validateGoogleIdToken(idToken: string, platform: string) {
    try {
      const { google } = config();
      let audience = google.androidOAuthClientID;
      switch (platform) {
        case 'web':
          audience = google.webOAuthClientID;
          break;
        case 'ios':
          audience = google.IOSOAuthClientID;
          break;
        default:
      }

      const ticket = await this.googleOAuthClient.verifyIdToken({
        idToken,
        audience,
      });
      const payload = ticket.getPayload();
      const [firstName, ...lastName] = payload.name?.split(' ') ?? [];

      return {
        firstName,
        lastName: lastName.join(' '),
        email: payload.email,
        avatar: payload.picture,
        oAuthIdentifier: idToken,
      };
    } catch (error) {
      this.logger.error(`error validating google id token - ${error.message}`, {
        idToken,
      });
      throw new BadRequestException('invalid google id token');
    }
  }

  async validateFacebookAccessToken(accessToken: string) {
    try {
      const { appId } = config().facebook;
      const response = await Http.request<{ data: Record<string, string> }>({
        method: 'GET',
        url: 'https://graph.facebook.com/v9.0/debug_token',
        params: {
          input_token: accessToken,
          access_token: appId,
        },
      });
      if (!response?.data?.is_valid) {
        throw new Error('invalid response');
      }

      const response0 = await Http.request<Record<string, unknown>>({
        method: 'GET',
        url: `https://graph.facebook.com/v9.0/${response.data.user_id}`,
        params: {
          fields: 'name,email,picture',
          access_token: appId,
        },
      });

      const [firstName, ...lastName] =
        (response0.name as string)?.split(' ') ?? [];

      return {
        firstName,
        lastName: lastName.join(' '),
        email: response0.email as string,
        avatar: (response0.picture as { data: { url: string } }).data.url,
        oAuthIdentifier: accessToken,
      };
    } catch (error) {
      this.logger.error(
        `error validating facebook access token - ${error.message}`,
        { accessToken, response: error.response },
      );
      throw new BadRequestException('invalid facebook access token');
    }
  }

  async validateOAuthIdentifier(
    identifier: string,
    provider: OAuthProvider,
    conf: { platform?: string } = {},
  ) {
    switch (provider) {
      case OAuthProvider.Facebook:
        return this.validateFacebookAccessToken(identifier);
      case OAuthProvider.Google:
        return this.validateGoogleIdToken(identifier, conf.platform);
      default:
        throw new BadRequestException('unsupported oauth provider');
    }
  }

  async signUp(payload: SignupDTO) {
    const {
      oAuthIdentifier,
      oAuthProvider,
      phoneNumber,
      email,
      emailOtp,
      phoneOtp,
      ...rest
    } = payload;
    if (oAuthIdentifier) {
      let user = await this.userService.findUser({
        oAuthIdentifier,
        deleted: { $ne: true },
      });
      if (!user) {
        const userObj = await this.validateOAuthIdentifier(
          oAuthIdentifier,
          oAuthProvider,
          { platform: payload.platform },
        );

        user = await this.userService.findUserOrCreate(
          {
            $or: [
              { email: userObj.email },
              { oAuthIdentifier: userObj.oAuthIdentifier },
            ],
          },
          {
            ...userObj,
            password: Crypto.randomBytes(32).toString('hex'),
            oAuthProvider,
          },
        );
      }

      return this.authorizeUser(user);
    }

    const userObj: typeof payload = { ...rest, email: null };
    if (phoneNumber) {
      const _phoneNumber = Util.formatPhoneNumber(phoneNumber, 'NG');

      const otp = await this.authTokenModel.findOne({
        'meta.phoneNumber': _phoneNumber,
        'meta.type': 'phone-otp',
        token: phoneOtp,
        deleted: { $ne: true },
        expiresAt: { $gte: new Date() },
      });
      if (!otp) {
        throw new BadRequestException('invalid phone validation token');
      }

      const existingUser = await this.userService.findUser({
        phoneNumber: _phoneNumber,
        deleted: { $ne: true },
      });
      if (existingUser) {
        return this.authorizeUser(existingUser);
      }

      userObj.phoneNumber = _phoneNumber;
    }

    if (email) {
      const _email = email.toLowerCase();
      const existingUser = await this.userService.findUser({
        email: _email,
        deleted: { $ne: true },
      });
      if (existingUser) {
        throw new ConflictException('user with email already exists');
      }

      const otp = await this.authTokenModel.findOne({
        'meta.email': _email,
        'meta.type': 'email-otp',
        token: emailOtp,
        deleted: { $ne: true },
        expiresAt: { $gte: new Date() },
      });
      if (!otp) {
        throw new BadRequestException('invalid email validation token');
      }

      userObj.email = _email;
    }

    const user = await this.userService.createUser({
      ...userObj,
      password: Crypto.randomBytes(32).toString('hex'),
      oAuthProvider,
    });

    return this.authorizeUser(user);
  }

  async authorizeUser(user: UserDocument) {
    const payloadId = await hash(`${user.phoneNumber}${user.password}`, 8);
    const token = this.jwtService.sign({ id: user.id, payloadId });

    return { user, token };
  }
}
