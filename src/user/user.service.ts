import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FilterQuery } from 'mongoose';
import { DatabaseService } from '../database/database.service';
import { UserDocument } from '../database/schemas/user.schema';
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
  constructor(private readonly db: DatabaseService) {}

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

    return this.db.users.findOneAndUpdate(
      { _id: user.id },
      { $set: update },
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

    const _user = await this.db.users.findOneAndUpdate(
      { _id: user.id },
      { $set: { preferences } },
      { new: true, upsert: false },
    );

    return _user.preferences;
  }

  async listDrivers(query: AdminGetDriversDTO) {
    const { page = 1, limit = 100, verified } = query;
    const driverIds = await this.db.rides.distinct('driver', {
      deleted: { $ne: true },
    });

    const q: FilterQuery<UserDocument> = {
      _id: { $in: driverIds },
      deleted: { $ne: true },
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

  async setVerification(userId: string, payload: SetUserVerificationDTO) {
    const user = await this.db.users.findOneAndUpdate(
      { _id: userId, deleted: { $ne: true } },
      { $set: { isVerified: payload.isVerified } },
      { new: true, upsert: false },
    );
    if (!user) {
      throw new NotFoundException('user not found');
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
