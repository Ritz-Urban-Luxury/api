import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { compare, hash } from 'bcryptjs';
import { SchemaTypes } from 'mongoose';
import { BaseSchema, Schema } from '../../shared/base.schema';
import { DB_TABLES } from '../../shared/constants';
import { Document } from '../../shared/types';

export enum OAuthProvider {
  Google = 'Google',
  Facebook = 'Facebook',
  Apple = 'Apple',
}

export const OAuthProviders = Object.values(OAuthProvider);

export enum TestAccountPurpose {
  Development = 'development',
  QA = 'qa',
  AppReview = 'app-review',
}

export const TestAccountPurposes = Object.values(TestAccountPurpose);

export enum AdminRole {
  Admin = 'Admin',
  SuperAdmin = 'SuperAdmin',
}

export enum DriverReviewStatus {
  Pending = 'Pending',
  ChangesRequested = 'ChangesRequested',
  Approved = 'Approved',
  Rejected = 'Rejected',
}

export enum DriverReviewField {
  ProfilePhoto = 'ProfilePhoto',
  DriverLicense = 'DriverLicense',
  LicenseNumber = 'LicenseNumber',
  LicenseExpiry = 'LicenseExpiry',
  VehicleDetails = 'VehicleDetails',
  VehiclePhotos = 'VehiclePhotos',
}

export const AdminRoles = Object.values(AdminRole);
export const DriverReviewStatuses = Object.values(DriverReviewStatus);
export const DriverReviewFields = Object.values(DriverReviewField);

export type DriverReviewIssue = {
  field: DriverReviewField;
  reason: string;
  rideId?: string;
};

export type PushPlatform = 'ios' | 'android';
export type PushApp = 'rider' | 'driver';

export type PushDevice = {
  token: string;
  platform: PushPlatform;
  app: PushApp;
  updatedAt?: Date;
};

export type UserDocument = User &
  Document & {
    isValidPassword(password: string): Promise<boolean>;
  };

@Schema({
  toJSON: {
    virtuals: true,
    transform(_doc: unknown, ret: UserDocument): void {
      delete ret._id;
      delete ret.__v;
      delete ret.password;
      delete ret.oAuthIdentifier;
      delete ret.oAuthProvider;
      delete ret.preferences;
      delete ret.pushDevices;
    },
  },
})
export class User extends BaseSchema {
  @Prop()
  firstName: string;

  @Prop()
  lastName: string;

  @Prop()
  phoneNumber?: string;

  @Prop()
  email: string;

  @Prop({ required: true })
  password?: string;

  @Prop()
  avatar?: string;

  @Prop()
  license?: string;

  @Prop([{ type: String }])
  languages: string[];

  @Prop()
  oAuthIdentifier?: string;

  @Prop({ type: String, enum: OAuthProviders })
  oAuthProvider?: OAuthProvider;

  @Prop({ type: SchemaTypes.Mixed, default: {} })
  preferences: Record<string, unknown>;

  @Prop()
  city?: string;

  @Prop()
  vehiclesInFleet?: string;

  @Prop()
  licenseNumber?: string;

  @Prop()
  licenseExpiry?: Date;

  @Prop({ default: false })
  isVerified?: boolean;

  @Prop({
    type: String,
    enum: DriverReviewStatuses,
    default: DriverReviewStatus.Pending,
  })
  driverReviewStatus?: DriverReviewStatus;

  @Prop({
    type: [
      {
        _id: false,
        field: { type: String, enum: DriverReviewFields, required: true },
        reason: { type: String, required: true },
        rideId: { type: String },
      },
    ],
    default: [],
  })
  driverReviewIssues?: DriverReviewIssue[];

  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS })
  driverReviewedBy?: UserDocument | string;

  @Prop()
  driverReviewedAt?: Date;

  @Prop()
  driverResubmittedAt?: Date;

  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.SERVICE_LOCATIONS })
  serviceLocation?: string;

  @Prop({ enum: ['camera', 'library'] })
  avatarSource?: 'camera' | 'library';

  /** True when the account was created via the driver app signup. */
  @Prop({ default: false })
  isDriver?: boolean;

  /** Unique driver invite / referral code (not company registration). */
  @Prop({ sparse: true, unique: true, uppercase: true, trim: true })
  inviteCode?: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS })
  referredBy?: string;

  @Prop()
  billingType?: string;

  @Prop()
  companyName?: string;

  @Prop()
  address?: string;

  @Prop()
  registrationCode?: string;

  @Prop()
  vatNumber?: string;

  @Prop()
  bankHolderName?: string;

  @Prop()
  bank?: string;

  @Prop()
  accountNumber?: string;

  @Prop()
  isAppAdmin?: boolean;

  @Prop({ type: String, enum: AdminRoles, default: AdminRole.Admin })
  adminRole?: AdminRole;

  /** Server-controlled marker for accounts whose data may be destructively purged. */
  @Prop({ default: false })
  isTestAccount?: boolean;

  @Prop({ type: String, enum: TestAccountPurposes })
  testAccountPurpose?: TestAccountPurpose;

  @Prop()
  deletionRequestedAt?: Date;

  @Prop()
  deletedAt?: Date;

  @Prop({
    type: [
      {
        token: { type: String, required: true },
        platform: { type: String, enum: ['ios', 'android'], required: true },
        app: { type: String, enum: ['rider', 'driver'], required: true },
        updatedAt: { type: Date },
      },
    ],
    default: [],
  })
  pushDevices: PushDevice[];
}

export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.index({ deleted: 1, isDriver: 1, isAppAdmin: 1, createdAt: 1 });

UserSchema.virtual('requiresProfileSetup').get(function requiresProfileSetup() {
  return Boolean(this.oAuthProvider && !this.phoneNumber);
});

UserSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) {
    next();
    return;
  }

  const values = this as UserDocument;
  const hashed = await hash(values.password, 8);
  values.password = hashed;
  next();
});

UserSchema.method(
  'isValidPassword',
  async function isValidPassword(candidatePassword) {
    const values = this as UserDocument;
    return compare(candidatePassword, values.password);
  },
);
