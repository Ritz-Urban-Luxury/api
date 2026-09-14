import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FilterQuery } from 'mongoose';
import { DatabaseService } from '../database/database.service';
import { UserDocument } from '../database/schemas/user.schema';
import { PushNotificationService } from '../notification/push-notification.service';
import { Util } from '../shared/util';
import {
  AdminGetDriversDTO,
  AdminListUsersDTO,
  SetUserAdminDTO,
  SetUserVerificationDTO,
  UpdateUserDTO,
} from './dto/user.dto';

@Injectable()
export class UserService {
  constructor(
    private readonly db: DatabaseService,
    private readonly push: PushNotificationService,
  ) {}

  async updateUser(user: UserDocument, update: UpdateUserDTO) {
    const { email, emailOtp } = update;
    if (email) {
      const _email = email.toLocaleLowerCase();
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
        body: 'You’re verified — open the app and go online to take rides.',
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
      const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
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

  async setAdmin(userId: string, payload: SetUserAdminDTO) {
    const user = await this.db.users.findOneAndUpdate(
      { _id: userId, deleted: { $ne: true } },
      { $set: { isAppAdmin: payload.isAppAdmin } },
      { new: true, upsert: false },
    );
    if (!user) {
      throw new NotFoundException('user not found');
    }

    return user;
  }
}
