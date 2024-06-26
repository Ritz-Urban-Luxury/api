import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WsException } from '@nestjs/websockets';
import { compare, hash } from 'bcryptjs';
import * as Crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
// import moment from 'moment';
import { Socket } from 'socket.io';
import { DatabaseService } from '../database/database.service';
import { OAuthProvider, UserDocument } from '../database/schemas/user.schema';
import { FileService } from '../file/file.service';
import { Logger } from '../logger/logger.service';
import { NotificationService } from '../notification';
import config from '../shared/config';
import { Http } from '../shared/http';
import { Util } from '../shared/util';
import {
  LoginDTO,
  RequestEmailOTPDTO,
  RequestPhoneOTPDTO,
  SignupDTO,
} from './authentication.dto';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const moment = require('moment');

@Injectable()
export class AuthenticationService {
  private readonly googleOAuthClient: OAuth2Client;

  constructor(
    private readonly notificationService: NotificationService,
    private readonly logger: Logger,
    private readonly jwtService: JwtService,
    private readonly fileService: FileService,
    private readonly db: DatabaseService,
  ) {
    this.googleOAuthClient = new OAuth2Client();
  }

  async requestPhoneOtp(payload: RequestPhoneOTPDTO) {
    const { phoneNumber } = payload;
    const phone = Util.formatPhoneNumber(phoneNumber, 'NG');
    const previousAuthToken = await this.db.authTokens.findOne({
      'meta.type': 'phone-otp',
      'meta.phoneNumber': phone,
      createdAt: {
        $gte: moment().subtract(100, 'seconds').toDate(),
      },
    });
    if (!previousAuthToken) {
      const token = Math.random().toString().substring(2, 6);

      await this.db.authTokens.create({
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
          sms: `_${token}_`,
        })
        .catch((error) => {
          this.logger.error(`error sending phone otp sms - ${error.message}`);
        });
    }
  }

  async requestEmailOtp(payload: RequestEmailOTPDTO) {
    const { email: _email, name } = payload;
    const email = _email.toLowerCase();
    const previousAuthToken = await this.db.authTokens.findOne({
      'meta.type': 'email-otp',
      'meta.email': email,
      createdAt: {
        $gte: moment().subtract(100, 'seconds').toDate(),
      },
    });
    if (!previousAuthToken) {
      const token = Math.random().toString().substring(2, 6);

      await this.db.authTokens.create({
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

  async checkOtp(otp: string) {
    const token = await this.db.authTokens.findOne({
      $or: [{ 'meta.type': 'email-otp' }, { 'meta.type': 'phone-otp' }],
      token: otp,
    });

    return !!token;
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
      const { accessToken: appAccesstoken } = config().facebook;
      const { data: response } = await Http.request<{
        data: Record<string, string>;
      }>({
        method: 'GET',
        url: 'https://graph.facebook.com/v9.0/debug_token',
        params: {
          input_token: accessToken,
          access_token: appAccesstoken,
        },
      });

      this.logger.log('facebook authentication response', response);

      if (!response?.data?.is_valid) {
        throw new Error('invalid response');
      }

      const { data: response0 } = await Http.request<Record<string, unknown>>({
        method: 'GET',
        url: `https://graph.facebook.com/v9.0/${response.data.user_id}`,
        params: {
          fields: 'name,email,picture',
          access_token: accessToken,
        },
      });

      const [firstName, ...lastName] =
        (response0.name as string)?.split(' ') ?? [];

      this.logger.log('facebook authentication data', response0);

      return {
        firstName,
        lastName: lastName.join(' '),
        email: response0.email as string,
        avatar: (response0.picture as { data: { url: string } }).data.url,
        oAuthIdentifier: response0.id,
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

  async getPhoneOtpOrFail(phoneNumber: string, phoneOtp: string) {
    const _phoneNumber = Util.formatPhoneNumber(phoneNumber, 'NG');

    const otp = await this.db.authTokens.findOne({
      'meta.phoneNumber': _phoneNumber,
      'meta.type': 'phone-otp',
      token: phoneOtp,
      deleted: { $ne: true },
      isUsed: { $ne: true },
      expiresAt: { $gte: new Date() },
    });

    if (!otp) {
      throw new BadRequestException('invalid phone validation token');
    }

    return otp;
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
      let user = await this.db.users.findOne({
        oAuthIdentifier,
        deleted: { $ne: true },
      });
      if (!user) {
        const userObj = await this.validateOAuthIdentifier(
          oAuthIdentifier,
          oAuthProvider,
          { platform: payload.platform },
        );

        if (userObj.avatar) {
          userObj.avatar = await this.fileService.uploadUrl(userObj.avatar);
        }

        user = await this.db.users.findOneAndUpdate(
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
          { upsert: true, new: true },
        );
      }

      return this.authorizeUser(user);
    }

    const userObj: typeof payload = { ...rest, email: null };
    if (phoneNumber) {
      const _phoneNumber = Util.formatPhoneNumber(phoneNumber, 'NG');

      if (phoneOtp) {
        const otp = await this.getPhoneOtpOrFail(phoneNumber, phoneOtp);

        await this.db.authTokens.updateOne(
          { _id: otp.id },
          { $set: { isUsed: true } },
        );
      }

      const existingUser = await this.db.users.findOne({
        phoneNumber: _phoneNumber,
        deleted: { $ne: true },
      });

      if (existingUser) {
        throw new ConflictException('user with phone number already exists');
      }

      userObj.phoneNumber = _phoneNumber;
    }

    if (email) {
      const _email = email.toLowerCase();
      const existingUser = await this.db.users.findOne({
        email: _email,
        deleted: { $ne: true },
      });
      if (existingUser) {
        throw new ConflictException('user with email already exists');
      }

      if (emailOtp) {
        const otp = await this.db.authTokens.findOne({
          'meta.email': _email,
          'meta.type': 'email-otp',
          token: emailOtp,
          deleted: { $ne: true },
          isUsed: { $ne: true },
          expiresAt: { $gte: new Date() },
        });
        if (!otp) {
          throw new BadRequestException('invalid email validation token');
        }

        await this.db.authTokens.updateOne(
          { _id: otp.id },
          { $set: { isUsed: true } },
        );
      }

      userObj.email = _email;
    }

    const user = await this.db.users.create({
      ...userObj,
      password: Crypto.randomBytes(32).toString('hex'),
      oAuthProvider,
    });

    return this.authorizeUser(user);
  }

  async login(payload: LoginDTO) {
    const { phoneNumber, otp, identifier, password } = payload;
    if (phoneNumber && otp) {
      const _phoneNumber = Util.formatPhoneNumber(phoneNumber, 'NG');
      const [user, otpDoc] = await Promise.all([
        this.db.users.findOne({ phoneNumber: _phoneNumber }),
        this.getPhoneOtpOrFail(phoneNumber, otp),
      ]);
      if (user) {
        const [authUser] = await Promise.all([
          this.authorizeUser(user),
          this.db.authTokens.updateOne(
            { _id: otpDoc.id },
            { $set: { isUsed: true } },
          ),
        ]);

        return authUser;
      }
    }

    if (identifier && password) {
      let _phoneNumber = 'invalid';
      try {
        _phoneNumber = Util.formatPhoneNumber(identifier, 'NG');
      } catch (error) {
        // phone invalid
      }

      const user = await this.db.users.findOne({
        $or: [
          { phoneNumber: _phoneNumber },
          { email: identifier?.toLowerCase() },
        ],
        isVerified: true,
      });
      if (user) {
        const passwordIsValid = await user.isValidPassword(password);
        if (passwordIsValid) {
          return this.authorizeUser(user);
        }
      }
    }

    throw new UnauthorizedException('invalid credentials');
  }

  async authorizeUser(user: UserDocument) {
    const payloadId = await hash(`${user.phoneNumber}${user.password}`, 8);
    const token = this.jwtService.sign({ id: user.id, payloadId });

    return { user, token };
  }

  async getUser(key: string) {
    let phoneNumber = '';

    try {
      phoneNumber = Util.formatPhoneNumber(key, 'NG');
    } catch (error) {
      // ...
    }

    const user = await this.db.users.findOne({
      $or: [{ email: key.toLowerCase() }, { phoneNumber }],
    });
    if (!user) {
      throw new NotFoundException('user not found');
    }

    return key;
  }

  async getUserFromAuthToken(token: string, secret?: string) {
    const jwtPayload = this.jwtService.verify<{
      id: string;
      payloadId: string;
    }>(token, secret ? { secret } : null);
    const { id: _id, payloadId = '' } = jwtPayload;

    const user = await this.db.users.findOne({ _id });
    if (!user) {
      return null;
    }

    const isValid = await compare(
      `${user.phoneNumber}${user.password}`,
      payloadId,
    );
    if (!isValid) {
      return null;
    }

    return user;
  }

  async validateWebsocketClient(client: Socket) {
    try {
      const authorization =
        client.handshake.headers.authorization ||
        `${client.handshake.query.authorization}`;

      const token = authorization?.replace(/bearer /gi, '');
      const user = await this.getUserFromAuthToken(token);
      if (!user) {
        throw new Error();
      }

      return user;
    } catch (error) {
      throw new WsException('Unauthorized');
    }
  }

  async validateJwtPayload({ id: _id, payloadId = '' }) {
    const user = await this.db.users.findOne({
      _id,
    });
    if (user) {
      const isValid = await compare(
        `${user.phoneNumber}${user.password}`,
        payloadId,
      );
      if (isValid) {
        return user;
      }
    }

    return null;
  }
}
