import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WsException } from '@nestjs/websockets';
import { compare, hash } from 'bcryptjs';
import * as Crypto from 'crypto';
import { isMongoId } from 'class-validator';
import { OAuth2Client } from 'google-auth-library';
import { createRemoteJWKSet, jwtVerify } from 'jose';
// import moment from 'moment';
import { Socket } from 'socket.io';
import { ActivityLedgerService } from '../database/activity-ledger.service';
import { DatabaseService } from '../database/database.service';
import { ReferralService } from '../database/referral.service';
import { LocationsService } from '../locations/locations.service';
import { ActivityType } from '../database/schemas/activities.schema';
import {
  RideApprovalStatus,
  RideStatus,
  RideType,
} from '../database/schemas/rides.schema';
import {
  OAuthProvider,
  TestAccountPurpose,
  UserDocument,
} from '../database/schemas/user.schema';
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
  ResetPasswordDTO,
  SignupDTO,
  DriverSignupDTO,
} from './authentication.dto';
import {
  getPlayReviewAccounts,
  isDriverReviewAccount,
  PlayReviewAccount,
  playReviewOtpMatches,
} from './play-review-accounts';
import { generateOtp } from './otp';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const moment = require('moment');

const PLAY_REVIEW_ATTEMPT_WINDOW_MINUTES = 15;
const PLAY_REVIEW_MAX_FAILED_ATTEMPTS = 5;
const PLAY_REVIEW_SYNTHETIC_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

@Injectable()
export class AuthenticationService {
  private readonly googleOAuthClient: OAuth2Client;

  // Cached across requests; `jose` refreshes the keys under the hood
  // when it hits an unrecognized `kid`.
  private readonly appleJwks = createRemoteJWKSet(
    new URL('https://appleid.apple.com/auth/keys'),
  );

  private readonly playReviewAccounts = getPlayReviewAccounts();

  constructor(
    private readonly notificationService: NotificationService,
    private readonly logger: Logger,
    private readonly jwtService: JwtService,
    private readonly fileService: FileService,
    private readonly db: DatabaseService,
    private readonly activityLedger: ActivityLedgerService,
    private readonly referralService: ReferralService,
    private readonly locationsService: LocationsService,
  ) {
    this.googleOAuthClient = new OAuth2Client({
      redirectUri:
        config().google.redirectUri || 'com.ritz.ritz:/oauth2redirect/google',
    });
  }

  async requestPhoneOtp(payload: RequestPhoneOTPDTO) {
    const { phoneNumber, app = 'rider' } = payload;
    const phone = Util.formatPhoneNumber(phoneNumber, 'NG');
    const registrationTestAccount = this.getDriverRegistrationTestAccount();
    const registrationTestPhone = Util.formatPhoneNumber(
      config().driverRegistrationTest.phoneNumber,
      'NG',
    );
    const isRegistrationTestPhone = phone === registrationTestPhone;

    if (
      isRegistrationTestPhone &&
      (!registrationTestAccount || app !== 'driver')
    ) {
      throw new ServiceUnavailableException(
        'Driver registration test account is only available on staging',
      );
    }

    const reviewerAccount = this.getReviewerAccountByPhone(phone, app);
    const tokenType = reviewerAccount
      ? 'play-review-phone-otp-request'
      : 'phone-otp';
    const previousAuthToken = await this.db.authTokens.findOne({
      'meta.type': tokenType,
      'meta.phoneNumber': phone,
      createdAt: {
        $gte: moment().subtract(100, 'seconds').toDate(),
      },
    });
    if (!previousAuthToken) {
      if (registrationTestAccount && isRegistrationTestPhone) {
        await this.db.authTokens.create({
          expiresAt: moment().add(10, 'minute').toDate(),
          token: registrationTestAccount.otp,
          meta: {
            phoneNumber: phone,
            type: 'phone-otp',
          },
        });
        this.logger.log('Driver registration test OTP requested', {
          phoneNumber: phone,
        });
        return;
      }

      if (reviewerAccount) {
        await this.db.authTokens.create({
          expiresAt: moment().add(1, 'day').toDate(),
          token: Crypto.randomBytes(32).toString('hex'),
          meta: {
            phoneNumber: phone,
            type: tokenType,
          },
        });
        this.logger.log('Play reviewer OTP requested', {
          phoneNumber: phone,
          reviewerType: reviewerAccount.kind,
        });
        return;
      }

      const token = generateOtp();

      await this.db.authTokens.create({
        expiresAt: moment().add(10, 'minute').toDate(),
        token,
        meta: {
          phoneNumber: phone,
          type: 'phone-otp',
        },
      });

      try {
        await this.notificationService.sendSMS({
          to: phone,
          sms: `Your Ritz Urban Luxury verification code is ${token}. This code expires in 10 minutes. Do not share it with anyone.`,
          channel: 'dnd',
        });
      } catch (error) {
        await this.db.authTokens.deleteOne({
          token,
          'meta.phoneNumber': phone,
          'meta.type': 'phone-otp',
        });
        this.logger.error(
          `error sending phone otp sms - ${(error as Error).message}`,
        );
        throw new ServiceUnavailableException(
          'Unable to send verification code. Please try again.',
        );
      }
    }
  }

  async requestEmailOtp(payload: RequestEmailOTPDTO) {
    const { email: _email, name } = payload;
    const email = _email.toLowerCase().trim();
    const reviewerAccount = this.getReviewerAccount(email);
    const tokenType = reviewerAccount
      ? 'play-review-email-otp-request'
      : 'email-otp';
    const previousAuthToken = await this.db.authTokens.findOne({
      'meta.type': tokenType,
      'meta.email': email,
      createdAt: {
        $gte: moment().subtract(100, 'seconds').toDate(),
      },
    });
    if (!previousAuthToken) {
      if (reviewerAccount) {
        await this.db.authTokens.create({
          expiresAt: moment().add(1, 'day').toDate(),
          token: Crypto.randomBytes(32).toString('hex'),
          meta: {
            email,
            type: tokenType,
          },
        });
        this.logger.log('Play reviewer OTP requested', {
          email,
          reviewerType: reviewerAccount.kind,
        });
        return;
      }

      const token = generateOtp();

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
          context: {
            otp: token,
            name,
            currentYear: new Date().getFullYear(),
          },
          subject: 'Your Ritz verification code',
          template: 'email-otp.template.njk',
        })
        .catch((error) => {
          this.logger.error(
            `error sending email otp message - ${error.message}`,
          );
        });
    }
  }

  private getReviewerAccount(email: string): PlayReviewAccount | null {
    const normalizedEmail = email.toLowerCase().trim();
    return (
      this.playReviewAccounts.find(
        (account) => account.email === normalizedEmail,
      ) || null
    );
  }

  private getDriverRegistrationTestAccount(): {
    email: string;
    otp: string;
    phoneNumber: string;
  } | null {
    const runtime = config();
    const otp = runtime.driverRegistrationTest.otp;

    if (runtime.appEnvironment !== 'staging' || !otp || !/^\d{4}$/.test(otp)) {
      return null;
    }

    return {
      email: runtime.driverRegistrationTest.email,
      otp,
      phoneNumber: Util.formatPhoneNumber(
        runtime.driverRegistrationTest.phoneNumber,
        'NG',
      ),
    };
  }

  private getReviewerAccountByPhone(
    phoneNumber: string,
    app: 'rider' | 'driver' = 'rider',
  ): PlayReviewAccount | null {
    const accountKind = app === 'driver' ? 'driver' : 'rider';
    return (
      this.playReviewAccounts.find(
        (account) =>
          account.kind === accountKind && account.phoneNumber === phoneNumber,
      ) || null
    );
  }

  private async restoreDriverReviewerVehicles(driverId: string) {
    await Promise.all([
      this.db.rides.findOneAndUpdate(
        { registration: 'PLAY-REVIEW', 'specs.synthetic': true },
        {
          $set: {
            approvalStatus: RideApprovalStatus.Approved,
            brand: 'Toyota',
            cautionDeposit: 0,
            color: 'Black',
            deleted: false,
            driver: driverId,
            hourlyRate: 0,
            images: [PLAY_REVIEW_SYNTHETIC_IMAGE],
            insuranceFee: 0,
            model: 'Camry',
            registration: 'PLAY-REVIEW',
            specs: { seats: 4, synthetic: true, year: '2024' },
            status: RideStatus.Offline,
            type: RideType.Classic,
          },
          $unset: { approvalReason: 1, location: 1 },
        },
        { new: true, upsert: true },
      ),
      this.db.rides.findOneAndUpdate(
        { registration: 'PLAY-REVIEW-HIRE', 'specs.synthetic': true },
        {
          $set: {
            approvalStatus: RideApprovalStatus.Approved,
            brand: 'Mercedes-Benz',
            cautionDeposit: 0,
            color: 'Black',
            dailyRate: 0,
            deleted: false,
            driver: driverId,
            hourlyRate: 0,
            images: [],
            insuranceFee: 0,
            model: 'V-Class',
            registration: 'PLAY-REVIEW-HIRE',
            specs: { seats: 6, synthetic: true, year: '2024' },
            status: RideStatus.Online,
            type: RideType.Hire,
          },
          $unset: { approvalReason: 1, location: 1 },
        },
        { new: true, upsert: true },
      ),
    ]);
  }

  private async findOrRecreateReviewer(
    account: PlayReviewAccount,
    phoneNumber: string,
  ): Promise<UserDocument | null> {
    const existing = await this.db.users.findOne({
      email: account.email,
      phoneNumber,
      deleted: { $ne: true },
    });
    if (existing) return existing;
    if (account.kind !== 'rider' && account.kind !== 'driver') return null;

    const password = await hash(Crypto.randomBytes(32).toString('hex'), 8);
    const isDriver = account.kind === 'driver';
    const user = await this.db.users.findOneAndUpdate(
      { email: account.email, deleted: { $ne: true } },
      {
        $set: {
          ...(isDriver
            ? {
                accountNumber: '0000000000',
                address: 'Synthetic Google Play review account, Abuja',
                avatar: PLAY_REVIEW_SYNTHETIC_IMAGE,
                bank: 'Review Bank',
                bankHolderName: 'Play Driver Reviewer',
                city: 'Abuja',
                languages: ['English'],
                license: PLAY_REVIEW_SYNTHETIC_IMAGE,
                licenseExpiry: new Date('2035-12-31T00:00:00.000Z'),
                licenseNumber: 'PLAY-REVIEW-0001',
              }
            : {}),
          billingType: 'individual',
          deleted: false,
          email: account.email,
          firstName: 'Play',
          isAppAdmin: false,
          isDriver,
          isTestAccount: true,
          isVerified: isDriver,
          lastName: isDriver ? 'Driver Reviewer' : 'Rider Reviewer',
          phoneNumber,
          preferences: {
            playReview: true,
            syntheticDataOnly: true,
          },
          testAccountPurpose: TestAccountPurpose.AppReview,
        },
        $setOnInsert: { password },
        $unset: {
          deletedAt: 1,
          deletionRequestedAt: 1,
        },
      },
      { new: true, upsert: true },
    );
    if (user && isDriver) {
      await this.restoreDriverReviewerVehicles(user.id);
    }
    return user;
  }

  private reviewerRoleIsValid(
    account: PlayReviewAccount,
    user: UserDocument,
  ): boolean {
    if (user.isAppAdmin) {
      return false;
    }

    return isDriverReviewAccount(account)
      ? user.isDriver === true && user.isVerified === true
      : user.isDriver !== true;
  }

  private async verifyReviewerOtp(
    account: PlayReviewAccount,
    otp: string,
  ): Promise<boolean> {
    const attemptedSince = moment()
      .subtract(PLAY_REVIEW_ATTEMPT_WINDOW_MINUTES, 'minutes')
      .toDate();
    const failedAttempts = await this.db.authTokens.countDocuments({
      'meta.email': account.email,
      'meta.type': 'play-review-otp-attempt',
      'meta.success': false,
      createdAt: { $gte: attemptedSince },
    });

    if (failedAttempts >= PLAY_REVIEW_MAX_FAILED_ATTEMPTS) {
      this.logger.warn('Play reviewer OTP rate limit reached', {
        email: account.email,
        reviewerType: account.kind,
      });
      throw new HttpException(
        'Too many OTP attempts. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const success = playReviewOtpMatches(account, otp);
    await this.db.authTokens.create({
      expiresAt: moment()
        .add(PLAY_REVIEW_ATTEMPT_WINDOW_MINUTES, 'minutes')
        .toDate(),
      token: Crypto.randomBytes(32).toString('hex'),
      meta: {
        email: account.email,
        reviewerType: account.kind,
        success,
        type: 'play-review-otp-attempt',
      },
    });

    this.logger[success ? 'log' : 'warn'](
      `Play reviewer authentication ${success ? 'succeeded' : 'failed'}`,
      {
        email: account.email,
        reviewerType: account.kind,
      },
    );
    return success;
  }

  async checkOtp(otp: string) {
    const token = await this.db.authTokens.findOne({
      $or: [{ 'meta.type': 'email-otp' }, { 'meta.type': 'phone-otp' }],
      token: otp,
      deleted: { $ne: true },
      isUsed: { $ne: true },
      expiresAt: { $gte: new Date() },
    });

    return !!token;
  }

  async validateGoogleIdToken(idToken: string) {
    try {
      const { google } = config();
      const audience = [
        google.androidOAuthClientID,
        google.webOAuthClientID,
        google.IOSOAuthClientID,
      ].filter(Boolean);

      if (audience.length === 0) {
        throw new Error('no Google OAuth client IDs configured');
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

  async validateAppleIdentityToken(identityToken: string): Promise<{
    avatar?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    oAuthIdentifier: string;
  }> {
    try {
      const { apple } = config();

      if (!apple.bundleIds.length) {
        throw new Error('no Apple bundle IDs configured');
      }

      const { payload } = await jwtVerify(identityToken, this.appleJwks, {
        issuer: 'https://appleid.apple.com',
        audience: apple.bundleIds,
      });

      if (!payload.sub) {
        throw new Error('apple identity token is missing a subject claim');
      }

      // Apple only puts `sub` (a stable, per-app user id) and `email` in the
      // identity token - never the user's name. Name is only ever handed to
      // the client, once, on the very first authorization, so it has to be
      // supplied separately by the caller and merged in by `signUp`.
      return {
        email: typeof payload.email === 'string' ? payload.email : undefined,
        oAuthIdentifier: payload.sub,
      };
    } catch (error) {
      this.logger.error(
        `error validating apple identity token - ${error.message}`,
        { identityToken },
      );
      throw new BadRequestException('invalid apple identity token');
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

  async validateOAuthIdentifier(identifier: string, provider: OAuthProvider) {
    switch (provider) {
      case OAuthProvider.Facebook:
        return this.validateFacebookAccessToken(identifier);
      case OAuthProvider.Google:
        return this.validateGoogleIdToken(identifier);
      case OAuthProvider.Apple:
        return this.validateAppleIdentityToken(identifier);
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

  async getEmailOtpOrFail(email: string, emailOtp: string) {
    const normalizedEmail = email.toLowerCase().trim();

    const otp = await this.db.authTokens.findOne({
      'meta.email': normalizedEmail,
      'meta.type': 'email-otp',
      token: emailOtp,
      deleted: { $ne: true },
      isUsed: { $ne: true },
      expiresAt: { $gte: new Date() },
    });

    if (!otp) {
      throw new BadRequestException('invalid email validation token');
    }

    return otp;
  }

  async signUp(
    payload: SignupDTO,
    options: {
      isDriver?: boolean;
      testAccountPurpose?: TestAccountPurpose;
    } = {},
  ) {
    const isDriver = options.isDriver === true;
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
        );

        if (userObj.avatar) {
          userObj.avatar = await this.fileService.uploadUrl(userObj.avatar);
        }

        // Apple never puts a name in the identity token - it's only handed
        // to the client once, on first authorization - so fall back to
        // whatever the client sent us. Google/Facebook already resolve a
        // name from the token, so this is a no-op for them.
        const firstName = userObj.firstName || rest.firstName;
        const lastName = userObj.lastName || rest.lastName;

        user = await this.db.users.findOneAndUpdate(
          {
            deleted: { $ne: true },
            $or: [
              { email: userObj.email },
              { oAuthIdentifier: userObj.oAuthIdentifier },
            ],
          },
          {
            ...userObj,
            firstName,
            lastName,
            billingType: 'individual',
            password: Crypto.randomBytes(32).toString('hex'),
            oAuthProvider,
            isDriver,
          },
          { upsert: true, new: true },
        );

        await this.activityLedger.recordActivity({
          type: ActivityType.UserRegistered,
          title: 'New User Registration',
          meta: user.email || user.phoneNumber || user.id,
          user: user.id,
        });
        await this.referralService.ensureInviteCode(user);
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
      billingType: userObj.vehiclesInFleet ? 'company' : 'individual',
      password: Crypto.randomBytes(32).toString('hex'),
      oAuthProvider,
      isDriver,
      ...(isDriver ? { isVerified: false } : {}),
      ...(options.testAccountPurpose
        ? {
            isTestAccount: true,
            testAccountPurpose: options.testAccountPurpose,
          }
        : {}),
    });

    await this.activityLedger.recordActivity({
      type: ActivityType.UserRegistered,
      title: 'New User Registration',
      meta: user.email || user.phoneNumber || user.id,
      user: user.id,
    });
    await this.referralService.ensureInviteCode(user);

    return this.authorizeUser(user);
  }

  async signUpDriver(payload: DriverSignupDTO) {
    const location = await this.locationsService.getActiveOrFail(
      payload.locationId,
    );
    const registrationTestAccount = this.getDriverRegistrationTestAccount();
    const normalizedEmail = payload.email.trim().toLowerCase();
    const normalizedPhone = Util.formatPhoneNumber(payload.phoneNumber, 'NG');
    const configuredTestEmail = config().driverRegistrationTest.email;
    const configuredTestPhone = Util.formatPhoneNumber(
      config().driverRegistrationTest.phoneNumber,
      'NG',
    );
    const usesTestIdentity =
      normalizedEmail === configuredTestEmail ||
      normalizedPhone === configuredTestPhone;

    if (
      usesTestIdentity &&
      (!registrationTestAccount ||
        normalizedEmail !== registrationTestAccount.email ||
        normalizedPhone !== registrationTestAccount.phoneNumber)
    ) {
      throw new BadRequestException(
        'Use the configured staging registration test email and phone number together',
      );
    }

    return this.signUp(
      {
        city: location.name,
        email: payload.email,
        firstName: undefined,
        lastName: undefined,
        phoneNumber: payload.phoneNumber,
        phoneOtp: payload.phoneOtp,
        serviceLocation: String(location.id),
        vehiclesInFleet: payload.vehiclesInFleet,
      },
      {
        isDriver: true,
        ...(usesTestIdentity
          ? { testAccountPurpose: TestAccountPurpose.QA }
          : {}),
      },
    );
  }

  async login(payload: LoginDTO) {
    const { phoneNumber, otp, identifier, password, app = 'rider' } = payload;
    if (phoneNumber && otp) {
      const _phoneNumber = Util.formatPhoneNumber(phoneNumber, 'NG');
      const reviewerAccount = this.getReviewerAccountByPhone(_phoneNumber, app);
      if (reviewerAccount) {
        const otpIsValid = await this.verifyReviewerOtp(reviewerAccount, otp);
        if (!otpIsValid) {
          throw new UnauthorizedException('invalid credentials');
        }
        const user = await this.findOrRecreateReviewer(
          reviewerAccount,
          _phoneNumber,
        );
        if (user && this.reviewerRoleIsValid(reviewerAccount, user)) {
          return this.authorizeUser(user);
        }

        if (user) {
          this.logger.error('Play reviewer account has an invalid role', {
            phoneNumber: _phoneNumber,
            reviewerType: reviewerAccount.kind,
          });
        }
        throw new UnauthorizedException('invalid credentials');
      }

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

    if (identifier && otp && !password) {
      const email = identifier.toLowerCase().trim();
      const reviewerAccount = this.getReviewerAccount(email);
      if (reviewerAccount) {
        const otpIsValid = await this.verifyReviewerOtp(reviewerAccount, otp);
        if (!otpIsValid) {
          throw new UnauthorizedException('invalid credentials');
        }
        const user =
          (reviewerAccount.kind === 'rider' ||
            reviewerAccount.kind === 'driver') &&
          reviewerAccount.phoneNumber
            ? await this.findOrRecreateReviewer(
                reviewerAccount,
                reviewerAccount.phoneNumber,
              )
            : await this.db.users.findOne({
                email,
                deleted: { $ne: true },
              });
        if (user && this.reviewerRoleIsValid(reviewerAccount, user)) {
          return this.authorizeUser(user);
        }

        if (user) {
          this.logger.error('Play reviewer account has an invalid role', {
            email,
            reviewerType: reviewerAccount.kind,
          });
        }
        throw new UnauthorizedException('invalid credentials');
      }

      const [user, otpDoc] = await Promise.all([
        this.db.users.findOne({
          email,
          deleted: { $ne: true },
        }),
        this.getEmailOtpOrFail(email, otp),
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
        deleted: { $ne: true },
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

  async resetPassword(payload: ResetPasswordDTO) {
    const email = payload.email.toLowerCase().trim();
    const otpDoc = await this.getEmailOtpOrFail(email, payload.otp);
    const user = await this.db.users.findOne({
      email,
      deleted: { $ne: true },
    });
    if (!user) {
      throw new NotFoundException('user not found');
    }

    if (!payload.password || payload.password.length < 8) {
      throw new BadRequestException('password must be at least 8 characters');
    }

    user.password = payload.password;
    await user.save();

    await this.db.authTokens.updateOne(
      { _id: otpDoc.id },
      { $set: { isUsed: true } },
    );

    return this.authorizeUser(user);
  }

  async authorizeUser(user: UserDocument) {
    // Bind sessions to the password rather than mutable profile fields. OAuth
    // users receive their first token before adding a phone number, so tying
    // the token to phoneNumber invalidates that session during profile setup.
    const payloadId = await hash(user.password, 8);
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

    if (!_id || !isMongoId(String(_id))) {
      return null;
    }

    const user = await this.db.users.findOne({ _id });
    if (!user) {
      return null;
    }

    const isValid = await this.isValidJwtPayloadId(user, payloadId);
    if (!isValid) {
      return null;
    }

    return user;
  }

  async validateWebsocketClient(client: Socket) {
    const authPayload = client.handshake.auth as
      | { token?: string; authorization?: string }
      | undefined;
    const raw = [
      client.handshake.headers.authorization,
      client.handshake.query?.authorization,
      authPayload?.authorization,
      authPayload?.token,
    ]
      .flat()
      .filter((v): v is string => typeof v === 'string' && v.length > 0);

    const tokens = [
      ...new Set(raw.map((auth) => auth.replace(/bearer /gi, '').trim())),
    ].filter(Boolean);

    const results = await Promise.all(
      tokens.map(async (token) => {
        try {
          return await this.getUserFromAuthToken(token);
        } catch {
          return null;
        }
      }),
    );
    const user = results.find((candidate) => candidate);
    if (user) {
      return user;
    }

    throw new WsException('Unauthorized');
  }

  async validateJwtPayload({ id: _id, payloadId = '' }) {
    if (!_id || !isMongoId(String(_id))) {
      return null;
    }

    const user = await this.db.users.findOne({
      _id,
      deleted: { $ne: true },
    });
    if (user) {
      const isValid = await this.isValidJwtPayloadId(user, payloadId);
      if (isValid) {
        return user;
      }
    }

    return null;
  }

  private async isValidJwtPayloadId(
    user: UserDocument,
    payloadId: string,
  ): Promise<boolean> {
    const values = [
      user.password,
      // Accept tokens issued by older builds while users migrate to the
      // password-bound payload format.
      `${user.phoneNumber}${user.password}`,
      // OAuth setup tokens were issued while phoneNumber was undefined.
      ...(user.oAuthProvider ? [`undefined${user.password}`] : []),
    ];

    const matches = await Promise.all(
      [...new Set(values)].map((value) => compare(value, payloadId)),
    );
    return matches.some(Boolean);
  }
}
