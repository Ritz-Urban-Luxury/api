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
import {
  DriverReviewField,
  DriverReviewStatus,
  UserDocument,
} from '../database/schemas/user.schema';
import { RentalStatus } from '../database/schemas/rentals.schema';
import {
  RideApprovalStatus,
  RideStatus,
  RideType,
  VehicleCategory,
} from '../database/schemas/rides.schema';
import { AdminAuditAction } from '../database/schemas/admin-audit-log.schema';
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
import {
  ResubmitDriverApplicationDTO,
  ReviewDriverApplicationDTO,
} from './dto/driver-review.dto';

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
    const {
      page = 1,
      limit = 100,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      verified,
    } = query;
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

    const term = search?.trim();
    if (term) {
      const regex = new RegExp(
        term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'i',
      );
      const driverFilter = q.$or;
      delete q.$or;
      q.$and = [
        { $or: driverFilter },
        {
          $or: [
            { firstName: regex },
            { lastName: regex },
            { email: regex },
            { phoneNumber: regex },
            { companyName: regex },
          ],
        },
      ];
    }

    const direction = sortOrder === 'asc' ? 1 : -1;
    const sort =
      sortBy === 'name'
        ? { firstName: direction, lastName: direction, createdAt: -1 }
        : { createdAt: direction };

    return this.db.users.paginate(q, {
      page,
      limit,
      select: '-password -oAuthIdentifier -oAuthProvider',
      sort,
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

  async reviewDriverApplication(
    admin: UserDocument,
    userId: string,
    payload: ReviewDriverApplicationDTO,
  ) {
    const current = await this.db.users.findOne({
      _id: userId,
      deleted: { $ne: true },
    });
    if (!current) throw new NotFoundException('driver not found');

    const issues = (payload.issues || []).map((issue) => ({
      field: issue.field,
      reason: issue.reason.trim(),
      ...(issue.rideId ? { rideId: issue.rideId } : {}),
    }));
    const now = new Date();

    if (
      payload.status === DriverReviewStatus.ChangesRequested &&
      (!issues.length || issues.some((issue) => !issue.reason))
    ) {
      throw new BadRequestException(
        'at least one correction with a reason is required',
      );
    }
    if (payload.status === DriverReviewStatus.ChangesRequested) {
      const vehicleFields = new Set([
        DriverReviewField.VehicleDetails,
        DriverReviewField.VehiclePhotos,
      ]);
      if (
        issues.some((issue) => vehicleFields.has(issue.field) && !issue.rideId)
      ) {
        throw new BadRequestException(
          'vehicle corrections must identify the vehicle to update',
        );
      }
      const issueVehicleIds = [
        ...new Set(
          issues
            .filter((issue) => vehicleFields.has(issue.field))
            .map((issue) => issue.rideId),
        ),
      ];
      const invalidVehicle = await Promise.all(
        issueVehicleIds.map((rideId) =>
          this.db.rides.findOne({
            _id: rideId,
            driver: current.id,
            deleted: { $ne: true },
            type: { $in: [RideType.Classic, RideType.Luxury] },
          }),
        ),
      );
      if (invalidVehicle.some((vehicle) => !vehicle)) {
        throw new BadRequestException(
          'one or more correction vehicles do not belong to this driver',
        );
      }
    }
    if (
      payload.status === DriverReviewStatus.Rejected &&
      !payload.reason?.trim()
    ) {
      throw new BadRequestException('rejection reason is required');
    }

    let approvedVehicleId: string | undefined;
    if (payload.status === DriverReviewStatus.Approved) {
      if (!current.avatar || !current.license || !current.licenseNumber) {
        throw new BadRequestException(
          'profile photo, driver license, and license number are required before approval',
        );
      }
      if (
        !current.licenseExpiry ||
        new Date(current.licenseExpiry).getTime() <= now.getTime()
      ) {
        throw new BadRequestException(
          'a valid future driver license expiry date is required',
        );
      }
      if (!payload.vehicleId || !payload.vehicleCategory) {
        throw new BadRequestException(
          'select and classify a trip vehicle before approving the driver',
        );
      }
      const vehicle = await this.db.rides.findOne({
        _id: payload.vehicleId,
        driver: current.id,
        deleted: { $ne: true },
        type: { $in: [RideType.Classic, RideType.Luxury] },
      });
      if (!vehicle) throw new BadRequestException('trip vehicle not found');
      if (
        !vehicle.brand?.trim() ||
        !vehicle.model?.trim() ||
        !vehicle.color?.trim() ||
        !vehicle.registration?.trim() ||
        !vehicle.images?.length
      ) {
        throw new BadRequestException(
          'complete vehicle details and photos are required before approval',
        );
      }
      approvedVehicleId = String(vehicle.id);
    }

    const session = await this.db.users.db.startSession();
    try {
      await session.withTransaction(async () => {
        const options = { session };
        if (
          payload.status === DriverReviewStatus.Approved &&
          approvedVehicleId &&
          payload.vehicleCategory
        ) {
          await this.db.rides.updateOne(
            { _id: approvedVehicleId, driver: current.id },
            {
              $set: {
                approvalStatus: RideApprovalStatus.Approved,
                approvalReason: 'Approved during driver application review',
                categoryReviewedAt: now,
                categoryReviewedBy: admin.id,
                status: RideStatus.Offline,
                type:
                  payload.vehicleCategory === VehicleCategory.Luxury
                    ? RideType.Luxury
                    : RideType.Classic,
                vehicleCategory: payload.vehicleCategory,
              },
            },
            options,
          );
        }

        if (payload.status === DriverReviewStatus.ChangesRequested) {
          const vehicleIssues = issues.filter((issue) => issue.rideId);
          await Promise.all(
            vehicleIssues.map((issue) =>
              this.db.rides.updateOne(
                { _id: issue.rideId, driver: current.id },
                {
                  $set: {
                    approvalReason: issue.reason,
                    approvalStatus: RideApprovalStatus.ChangesRequested,
                    status: RideStatus.Offline,
                  },
                },
                options,
              ),
            ),
          );
        }

        await this.db.users.updateOne(
          { _id: current.id },
          {
            $set: {
              driverReviewIssues: issues,
              driverReviewedAt: now,
              driverReviewedBy: admin.id,
              driverReviewStatus: payload.status,
              isDriver: true,
              isVerified: payload.status === DriverReviewStatus.Approved,
            },
          },
          options,
        );

        await this.db.adminAuditLogs.create(
          [
            {
              action: AdminAuditAction.DriverReviewed,
              actor: admin.id,
              reason:
                payload.reason?.trim() ||
                issues.map((issue) => issue.reason).join('; ') ||
                'Driver application approved',
              targetUserId: String(current.id),
              meta: {
                issues,
                status: payload.status,
                vehicleCategory: payload.vehicleCategory,
                vehicleId: approvedVehicleId,
              },
            },
          ],
          options,
        );
      });
    } finally {
      await session.endSession();
    }

    let notification = {
      title: 'Driver application update',
      body:
        payload.reason?.trim() || 'Your driver application was not approved.',
      type: 'DriverRejected',
    };
    if (payload.status === DriverReviewStatus.Approved) {
      notification = {
        title: 'Account approved',
        body: 'Your driver account is approved. You can now go online.',
        type: 'DriverVerified',
      };
    } else if (payload.status === DriverReviewStatus.ChangesRequested) {
      notification = {
        title: 'Action required on your application',
        body:
          issues[0]?.reason || 'Open Driver Portal to update your application.',
        type: 'DriverChangesRequested',
      };
    }
    this.push.sendToUser(current, {
      title: notification.title,
      body: notification.body,
      app: 'driver',
      data: {
        type: notification.type,
        url: '/(main)/settings/driver-portal',
        userId: String(current.id),
      },
    });

    return this.getDriverDetail(userId);
  }

  async resubmitDriverApplication(
    user: UserDocument,
    payload: ResubmitDriverApplicationDTO,
  ) {
    if (user.driverReviewStatus !== DriverReviewStatus.ChangesRequested) {
      throw new ConflictException('no document changes have been requested');
    }
    const issues = user.driverReviewIssues || [];
    const requested = new Set(issues.map((issue) => issue.field));
    const userUpdate: Record<string, unknown> = {};
    const assignIfRequested = (
      field: DriverReviewField,
      key: keyof ResubmitDriverApplicationDTO,
    ) => {
      const value = payload[key];
      if (value === undefined) return;
      if (!requested.has(field)) {
        throw new BadRequestException(`${key} was not requested for update`);
      }
      userUpdate[key] = value;
    };
    assignIfRequested(DriverReviewField.ProfilePhoto, 'avatar');
    if (payload.avatarSource !== undefined) {
      if (!requested.has(DriverReviewField.ProfilePhoto)) {
        throw new BadRequestException(
          'avatarSource was not requested for update',
        );
      }
      userUpdate.avatarSource = payload.avatarSource;
    }
    assignIfRequested(DriverReviewField.DriverLicense, 'license');
    assignIfRequested(DriverReviewField.LicenseNumber, 'licenseNumber');
    assignIfRequested(DriverReviewField.LicenseExpiry, 'licenseExpiry');

    const requiredUserCorrections: Array<{
      field: DriverReviewField;
      value: unknown;
      label: string;
    }> = [
      {
        field: DriverReviewField.ProfilePhoto,
        value: payload.avatar,
        label: 'profile photo',
      },
      {
        field: DriverReviewField.DriverLicense,
        value: payload.license,
        label: 'driver license',
      },
      {
        field: DriverReviewField.LicenseNumber,
        value: payload.licenseNumber?.trim(),
        label: 'license number',
      },
      {
        field: DriverReviewField.LicenseExpiry,
        value: payload.licenseExpiry,
        label: 'license expiry',
      },
    ];
    requiredUserCorrections.forEach((correction) => {
      if (requested.has(correction.field) && !correction.value) {
        throw new BadRequestException(
          `${correction.label} correction is required`,
        );
      }
    });
    if (payload.licenseExpiry) {
      const expiry = new Date(payload.licenseExpiry);
      if (Number.isNaN(expiry.getTime()) || expiry.getTime() <= Date.now()) {
        throw new BadRequestException(
          'license expiry date must be in the future',
        );
      }
      userUpdate.licenseExpiry = expiry;
    }

    const vehicleCorrections = payload.vehicles || [];
    issues
      .filter((item) => item.rideId)
      .forEach((issue) => {
        const correction = vehicleCorrections.find(
          (item) => item.rideId === issue.rideId,
        );
        if (!correction) {
          throw new BadRequestException(
            `correction for vehicle ${issue.rideId} is required`,
          );
        }
        if (
          issue.field === DriverReviewField.VehiclePhotos &&
          !correction.images?.length
        ) {
          throw new BadRequestException(
            'replacement vehicle photos are required',
          );
        }
        if (
          issue.field === DriverReviewField.VehicleDetails &&
          ![
            correction.brand,
            correction.model,
            correction.color,
            correction.registration,
          ].every((value) => value?.trim())
        ) {
          throw new BadRequestException('all vehicle details are required');
        }
      });
    vehicleCorrections.forEach((correction) => {
      const vehicleIssues = issues.filter(
        (issue) => issue.rideId === correction.rideId,
      );
      if (!vehicleIssues.length) {
        throw new BadRequestException(
          `vehicle ${correction.rideId} was not requested for update`,
        );
      }
      const allowsDetails = vehicleIssues.some(
        (issue) => issue.field === DriverReviewField.VehicleDetails,
      );
      const allowsPhotos = vehicleIssues.some(
        (issue) => issue.field === DriverReviewField.VehiclePhotos,
      );
      if (correction.images !== undefined && !allowsPhotos) {
        throw new BadRequestException(
          'vehicle photos were not requested for update',
        );
      }
      if (
        [
          correction.brand,
          correction.model,
          correction.color,
          correction.registration,
        ].some((value) => value !== undefined) &&
        !allowsDetails
      ) {
        throw new BadRequestException(
          'vehicle details were not requested for update',
        );
      }
    });

    if (!Object.keys(userUpdate).length && !vehicleCorrections.length) {
      throw new BadRequestException(
        'provide at least one requested correction',
      );
    }

    const now = new Date();
    const session = await this.db.users.db.startSession();
    try {
      await session.withTransaction(async () => {
        const options = { session };
        await Promise.all(
          vehicleCorrections.map((correction) => {
            const $set: Record<string, unknown> = {
              approvalStatus: RideApprovalStatus.Pending,
              status: RideStatus.Offline,
            };
            (
              ['brand', 'model', 'color', 'registration', 'images'] as const
            ).forEach((key) => {
              const value = correction[key];
              if (value !== undefined) {
                $set[key] =
                  key === 'registration'
                    ? String(value).trim().toUpperCase()
                    : value;
              }
            });
            return this.db.rides.updateOne(
              {
                _id: correction.rideId,
                driver: user.id,
                deleted: { $ne: true },
              },
              {
                $set,
                $unset: {
                  approvalReason: 1,
                  categoryReviewedAt: 1,
                  categoryReviewedBy: 1,
                  vehicleCategory: 1,
                },
              },
              options,
            );
          }),
        );
        await this.db.users.updateOne(
          { _id: user.id },
          {
            $set: {
              ...userUpdate,
              driverReviewIssues: [],
              driverReviewStatus: DriverReviewStatus.Pending,
              driverResubmittedAt: now,
              isVerified: false,
            },
          },
          options,
        );
        await this.db.adminAuditLogs.create(
          [
            {
              action: AdminAuditAction.DriverResubmitted,
              actor: user.id,
              reason: 'Driver resubmitted requested corrections',
              targetUserId: String(user.id),
              meta: {
                correctedFields: Object.keys(userUpdate),
                vehicleIds: vehicleCorrections.map((item) => item.rideId),
              },
            },
          ],
          options,
        );
      });
    } finally {
      await session.endSession();
    }
    return this.getDriverDetail(String(user.id));
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
      {
        $set: {
          driverReviewIssues: [],
          driverReviewStatus: payload.isVerified
            ? DriverReviewStatus.Approved
            : DriverReviewStatus.Pending,
          isVerified: payload.isVerified,
          isDriver: true,
        },
      },
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
