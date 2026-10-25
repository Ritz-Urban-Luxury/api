import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hash } from 'bcryptjs';
import { randomBytes } from 'crypto';
import { FilterQuery } from 'mongoose';
import { getPlayReviewAccount } from '../authentication/play-review-accounts';
import { DatabaseService } from '../database/database.service';
import { UserDocument } from '../database/schemas/user.schema';
import { RentalStatus } from '../database/schemas/rentals.schema';
import {
  RideApprovalStatus,
  RideStatus,
  RideType,
} from '../database/schemas/rides.schema';
import { InactiveTripStatuses } from '../database/schemas/trips.schema';
import { PushNotificationService } from '../notification/push-notification.service';
import { Util } from '../shared/util';
import config from '../shared/config';
import { hashOtp } from '../authentication/otp';
import { FinanceService } from '../finance/finance.service';
import {
  AdminGetDriversDTO,
  AdminCreateDriverDTO,
  AdminListUsersDTO,
  DeleteAccountDTO,
  SetUserVerificationDTO,
  UpdateUserDTO,
} from './dto/user.dto';

@Injectable()
export class UserService {
  constructor(
    private readonly db: DatabaseService,
    private readonly push: PushNotificationService,
    private readonly finance: FinanceService,
  ) {}

  async updateUser(user: UserDocument, update: UpdateUserDTO) {
    if (
      getPlayReviewAccount(user.email) &&
      update.email &&
      update.email.toLowerCase().trim() !== user.email.toLowerCase().trim()
    ) {
      throw new BadRequestException(
        'The reviewer account email cannot be changed',
      );
    }
    const { email, emailOtp, phoneNumber, phoneOtp } = update;
    if (email) {
      const _email = email.toLocaleLowerCase();
      const otp = await this.db.authTokens.findOne({
        'meta.email': _email,
        'meta.type': 'email-otp',
        $or: [
          { tokenHash: hashOtp(emailOtp, config().jwt.secret) },
          { token: emailOtp },
        ],
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

    if (phoneNumber) {
      const _phoneNumber = Util.formatPhoneNumber(phoneNumber, 'NG');
      const otp = await this.db.authTokens.findOne({
        'meta.phoneNumber': _phoneNumber,
        'meta.type': 'phone-otp',
        $or: [
          { tokenHash: hashOtp(phoneOtp, config().jwt.secret) },
          { token: phoneOtp },
        ],
        deleted: { $ne: true },
        isUsed: { $ne: true },
        expiresAt: { $gte: new Date() },
      });
      if (!otp) {
        throw new BadRequestException('invalid phone validation token');
      }

      const phoneNumberTaken = await this.db.users.exists({
        _id: { $ne: user.id },
        phoneNumber: _phoneNumber,
        deleted: { $ne: true },
      });
      if (phoneNumberTaken) {
        throw new ConflictException('user with phone number already exists');
      }

      await this.db.authTokens.updateOne(
        { _id: otp.id },
        { $set: { isUsed: true } },
      );
      update.phoneNumber = _phoneNumber;
    }

    ['licenseNumber', 'license', 'licenseExpiry'].forEach((key) => {
      if (user[key]) {
        delete update[key];
      }
    });

    update.email = update.email?.toLowerCase();

    const isDriverAccount = user.isDriver || Boolean(user.vehiclesInFleet);
    const isFleetOwner = Boolean(user.vehiclesInFleet?.trim());
    const unsetIndividualCompanyFields =
      isDriverAccount && !isFleetOwner
        ? {
            companyName: 1,
            registrationCode: 1,
            vatNumber: 1,
          }
        : undefined;

    if (isDriverAccount) {
      update.billingType = isFleetOwner ? 'company' : 'individual';

      if (!isFleetOwner) {
        delete update.companyName;
        delete update.registrationCode;
        delete update.vatNumber;
      }
    }

    return this.db.users.findOneAndUpdate(
      { _id: user.id },
      {
        $set: update,
        ...(unsetIndividualCompanyFields
          ? { $unset: unsetIndividualCompanyFields }
          : {}),
      },
      { new: true, upsert: false },
    );
  }

  async updatePreference(
    user: UserDocument,
    preferences: Record<string, unknown>,
  ) {
    if (!Util.isPriObj(preferences)) {
      throw new BadRequestException('invalid payload');
    }

    const nextPreferences = {
      ...(user.preferences || {}),
      ...preferences,
    };

    const _user = await this.db.users.findOneAndUpdate(
      { _id: user.id },
      { $set: { preferences: nextPreferences } },
      { new: true, upsert: false },
    );

    return _user.preferences;
  }

  async deleteAccount(user: UserDocument, payload: DeleteAccountDTO) {
    if (!payload.confirm) {
      throw new BadRequestException('account deletion must be confirmed');
    }

    const userId = user.id;
    const [activeTrip, activeRental] = await Promise.all([
      this.db.trips.findOne({
        $or: [{ user: userId }, { driver: userId }],
        status: { $nin: InactiveTripStatuses },
        deleted: { $ne: true },
      }),
      this.db.rentals.findOne({
        $or: [{ user: userId }, { driver: userId }],
        status: {
          $in: [
            RentalStatus.Pending,
            RentalStatus.Accepted,
            RentalStatus.InProgress,
          ],
        },
        deleted: { $ne: true },
      }),
    ]);

    if (activeTrip) {
      throw new ConflictException(
        'Complete or cancel your active trip before deleting your account',
      );
    }
    if (activeRental) {
      throw new ConflictException(
        'Complete or cancel your active car rental before deleting your account',
      );
    }
    const isDriver = Boolean(
      user.isDriver ||
        (await this.db.rides.exists({
          driver: userId,
          deleted: { $ne: true },
        })),
    );
    if (isDriver) {
      const position = await this.finance.getDriverFinancialPosition(user);
      if (position.cashCommissionDebt > 0) {
        throw new ConflictException(
          'You have an outstanding cash-trip commission. Please make the required payment before closing your account.',
        );
      }
      if (position.availablePayout > 0) {
        await this.finance.prepareDriverAccountClosurePayout(
          user,
          payload.bankAccountId,
        );
      }
    }

    const closureRequest = await this.finance.prepareAccountClosure(user, {
      destinationType: payload.destinationType,
      bankAccountId: payload.bankAccountId,
    });

    const now = new Date();
    const anonymizedPassword = await hash(randomBytes(32).toString('hex'), 8);

    const authTokenIdentifiers = [
      user.phoneNumber ? { 'meta.phoneNumber': user.phoneNumber } : undefined,
      user.email ? { 'meta.email': user.email } : undefined,
    ].filter(Boolean);

    await Promise.all([
      this.db.rides.updateMany(
        { driver: userId, deleted: { $ne: true } },
        {
          $set: { deleted: true, status: RideStatus.Offline },
          $unset: { location: 1 },
        },
      ),
      this.db.driverOnlineSessions.updateMany(
        { driver: userId, endedAt: { $exists: false } },
        { $set: { endedAt: now } },
      ),
      this.db.driverRideOffers.deleteMany({ driver: userId }),
      this.db.userBlocks.deleteMany({
        $or: [{ blocker: userId }, { blocked: userId }],
      }),
      this.db.cards.deleteMany({ user: userId }),
      this.db.messages.deleteMany({ sender: userId }),
      this.db.newsReads.deleteMany({ user: userId }),
      ...(authTokenIdentifiers.length > 0
        ? [this.db.authTokens.deleteMany({ $or: authTokenIdentifiers })]
        : []),
    ]);

    const deletedUser = await this.db.users.findOneAndUpdate(
      { _id: userId, deleted: { $ne: true } },
      {
        $set: {
          deleted: true,
          deletionRequestedAt: now,
          deletedAt: now,
          firstName: 'Deleted',
          lastName: 'User',
          password: anonymizedPassword,
          languages: [],
          preferences: {},
          pushDevices: [],
          isVerified: false,
          isDriver: false,
          isAppAdmin: false,
        },
        $unset: {
          phoneNumber: 1,
          email: 1,
          avatar: 1,
          avatarSource: 1,
          license: 1,
          oAuthIdentifier: 1,
          oAuthProvider: 1,
          city: 1,
          serviceLocation: 1,
          vehiclesInFleet: 1,
          licenseNumber: 1,
          licenseExpiry: 1,
          inviteCode: 1,
          referredBy: 1,
          billingType: 1,
          companyName: 1,
          address: 1,
          registrationCode: 1,
          vatNumber: 1,
          bankHolderName: 1,
          bank: 1,
          accountNumber: 1,
        },
      },
      { new: true, upsert: false },
    );

    if (!deletedUser) {
      throw new NotFoundException('account not found');
    }

    return {
      deleted: true,
      deletedAt: now,
      closureRequest: closureRequest
        ? {
            reference: closureRequest.publicReference,
            status: closureRequest.status,
            amount: closureRequest.amountKobo / 100,
          }
        : null,
    };
  }

  async getUserById(userId: string) {
    return this.db.users.findById(userId);
  }

  async listDrivers(query: AdminGetDriversDTO) {
    const { page = 1, limit = 100, verified } = query;
    const rideDriverIds = await this.db.rides.distinct('driver', {
      deleted: { $ne: true },
    });

    const q: FilterQuery<UserDocument> = {
      deleted: { $ne: true },
      $or: [{ isDriver: true }, { _id: { $in: rideDriverIds } }],
    };
    if (typeof verified === 'boolean') {
      q.isVerified = verified ? true : { $ne: true };
    }

    return this.db.users.paginate(q, {
      page,
      limit,
      select: '-password -oAuthIdentifier -oAuthProvider',
      sort: { createdAt: -1 },
    });
  }

  async createDriver(payload: AdminCreateDriverDTO) {
    const email = payload.email.trim().toLowerCase();
    const phoneNumber = Util.formatPhoneNumber(payload.phoneNumber, 'NG');
    const existing = await this.db.users.findOne({
      deleted: { $ne: true },
      $or: [{ email }, { phoneNumber }],
    });
    if (existing) {
      throw new ConflictException(
        existing.email === email
          ? 'user with email already exists'
          : 'user with phone number already exists',
      );
    }

    const user = await this.db.users.create({
      firstName: payload.firstName.trim(),
      lastName: payload.lastName.trim(),
      email,
      phoneNumber,
      password: payload.password,
      isDriver: true,
      isVerified: false,
      billingType: 'individual',
    });

    return user;
  }

  async getDriverDetail(userId: string) {
    const user = await this.db.users
      .findOne({
        _id: userId,
        deleted: { $ne: true },
      })
      .select('-password -oAuthIdentifier -oAuthProvider');

    if (!user) {
      throw new NotFoundException('driver not found');
    }

    const rides = await this.db.rides
      .find({
        driver: user.id,
        deleted: { $ne: true },
      })
      .sort({ createdAt: -1 });

    return {
      user,
      rides,
    };
  }

  async setVerification(userId: string, payload: SetUserVerificationDTO) {
    const current = await this.db.users.findOne({
      _id: userId,
      deleted: { $ne: true },
    });
    if (!current) {
      throw new NotFoundException('user not found');
    }
    if (payload.isVerified && (!current.avatar || !current.license)) {
      throw new BadRequestException(
        'profile photo and driver license are required before approval',
      );
    }
    if (payload.isVerified) {
      const approvedVehicle = await this.db.rides.exists({
        driver: current.id,
        deleted: { $ne: true },
        type: { $in: [RideType.Classic, RideType.Luxury] },
        approvalStatus: RideApprovalStatus.Approved,
        vehicleCategory: { $in: [RideType.Classic, RideType.Luxury] },
      });
      if (!approvedVehicle) {
        throw new BadRequestException(
          'approve and classify a trip vehicle before approving the driver',
        );
      }
    }

    const user = await this.db.users.findOneAndUpdate(
      { _id: userId, deleted: { $ne: true } },
      { $set: { isVerified: payload.isVerified, isDriver: true } },
      { new: true, upsert: false },
    );
    if (!user) {
      throw new NotFoundException('user not found');
    }

    if (payload.isVerified) {
      this.push.sendToUser(user, {
        title: 'Account approved',
        body: 'Your driver account is approved. You can go online once your vehicle and any required deposit are also approved.',
        app: 'driver',
        data: {
          type: 'DriverVerified',
          userId: String(user.id),
        },
      });
    }

    return user;
  }

  async listUsers(query: AdminListUsersDTO) {
    const { page = 1, limit = 100, search } = query;
    const q: FilterQuery<UserDocument> = {
      deleted: { $ne: true },
    };

    const term = search?.trim();
    if (term) {
      const regex = new RegExp(
        term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'i',
      );
      q.$or = [
        { email: regex },
        { firstName: regex },
        { lastName: regex },
        { phoneNumber: regex },
      ];
    }

    return this.db.users.paginate(q, {
      page,
      limit,
      select: '-password -oAuthIdentifier -oAuthProvider',
      sort: { createdAt: -1 },
    });
  }
}
