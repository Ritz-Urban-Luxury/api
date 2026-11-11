import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';
import { BaseSchema, EmbeddedSchema, Schema } from '../../shared/base.schema';
import { DB_TABLES } from '../../shared/constants';
import { Document } from '../../shared/types';
import { Location, LocationSchema } from './rides.schema';
import { UserDocument } from './user.schema';
import { DriverHirePlanType } from './driver-hire-settings.schema';

export enum DriverHireBookingStatus {
  PendingReview = 'PendingReview',
  Assigned = 'Assigned',
  DriverEnRoute = 'DriverEnRoute',
  DriverArrived = 'DriverArrived',
  InProgress = 'InProgress',
  Completed = 'Completed',
  Rejected = 'Rejected',
  Cancelled = 'Cancelled',
}

export enum DriverHirePaymentStatus {
  Pending = 'Pending',
  Charged = 'Charged',
  Failed = 'Failed',
  Refunded = 'Refunded',
}

export enum DriverHireTransmission {
  Automatic = 'Automatic',
  Manual = 'Manual',
}

export const DriverHireBookingStatuses = Object.values(DriverHireBookingStatus);
export const DriverHirePaymentStatuses = Object.values(DriverHirePaymentStatus);
export const DriverHireTransmissions = Object.values(DriverHireTransmission);

@EmbeddedSchema()
export class CustomerVehicle {
  @Prop({ required: true })
  make: string;

  @Prop({ required: true })
  model: string;

  @Prop({ required: true })
  year: number;

  @Prop({ required: true })
  color: string;

  @Prop({ required: true })
  registration: string;

  @Prop({ required: true })
  vehicleType: string;

  @Prop({ type: String, enum: DriverHireTransmissions, required: true })
  transmission: DriverHireTransmission;

  @Prop()
  notes?: string;

  @Prop()
  photoUrl?: string;
}

export const CustomerVehicleSchema =
  SchemaFactory.createForClass(CustomerVehicle);

@EmbeddedSchema()
export class DriverHirePricingSnapshot {
  @Prop({ required: true })
  hourlyRate: number;

  @Prop({ required: true })
  minimumHours: number;

  @Prop({ required: true })
  billingIncrementMinutes: number;

  @Prop({ required: true })
  logisticsFee: number;

  @Prop({
    type: String,
    enum: Object.values(DriverHirePlanType),
    default: DriverHirePlanType.Hourly,
  })
  planType?: DriverHirePlanType;

  @Prop({ default: 0 })
  baseRate?: number;

  @Prop({ default: 0 })
  discountPercent?: number;

  @Prop({ default: 1 })
  includedDays?: number;

  @Prop({ default: 0 })
  hoursPerDay?: number;

  @Prop({ default: 1 })
  validityDays?: number;

  @Prop({ default: 0 })
  overtimeHourlyRate?: number;

  @Prop({ default: 30 })
  overtimeBillingIncrementMinutes?: number;
}

export const DriverHirePricingSnapshotSchema = SchemaFactory.createForClass(
  DriverHirePricingSnapshot,
);

@EmbeddedSchema()
export class DriverHirePackageSchedule {
  @Prop({ required: true })
  startDate: Date;

  @Prop({ required: true })
  endDate: Date;

  @Prop([{ type: Number }])
  workingDays: number[];

  @Prop({ required: true })
  dailyStartTime: string;
}

export const DriverHirePackageScheduleSchema = SchemaFactory.createForClass(
  DriverHirePackageSchedule,
);

export enum DriverChangeRequestStatus {
  Pending = 'Pending',
  Approved = 'Approved',
  Rejected = 'Rejected',
}

@EmbeddedSchema()
export class DriverChangeRequest {
  @Prop({ required: true })
  reason: string;

  @Prop()
  note?: string;

  @Prop({ required: true, enum: Object.values(DriverChangeRequestStatus) })
  status: DriverChangeRequestStatus;

  @Prop({ required: true })
  requestedAt: Date;

  @Prop()
  resolvedAt?: Date;

  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS })
  resolvedBy?: UserDocument | string;

  @Prop()
  resolutionNote?: string;
}

export const DriverChangeRequestSchema =
  SchemaFactory.createForClass(DriverChangeRequest);

export type DriverHireBookingDocument = DriverHireBooking & Document;

@Schema()
export class DriverHireBooking extends BaseSchema {
  @Prop({ trim: true })
  clientRequestId?: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS, required: true })
  user: UserDocument | string;

  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS })
  assignedDriver?: UserDocument | string;

  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS })
  assignedBy?: UserDocument | string;

  @Prop({ type: String, enum: DriverHireBookingStatuses, required: true })
  status: DriverHireBookingStatus;

  @Prop({ required: true })
  scheduledAt: Date;

  @Prop({ required: true })
  expectedEndAt: Date;

  @Prop({ required: true })
  estimatedHours: number;

  @Prop({
    type: String,
    enum: Object.values(DriverHirePlanType),
    default: DriverHirePlanType.Hourly,
  })
  planType: DriverHirePlanType;

  @Prop({ type: DriverHirePackageScheduleSchema })
  packageSchedule?: DriverHirePackageSchedule;

  @Prop({ type: LocationSchema, required: true })
  pickup: Location;

  @Prop({ type: LocationSchema, required: true })
  completion: Location;

  @Prop([{ type: String }])
  additionalStops: string[];

  @Prop({ required: true })
  servicePurpose: string;

  @Prop()
  specialInstructions?: string;

  @Prop({ type: CustomerVehicleSchema, required: true })
  vehicle: CustomerVehicle;

  @Prop({ required: true })
  handoverContactName: string;

  @Prop({ required: true })
  handoverContactPhone: string;

  @Prop()
  returnContactName?: string;

  @Prop()
  returnContactPhone?: string;

  @Prop({ required: true, default: 0 })
  passengerCount: number;

  @Prop({ required: true })
  paymentMethod: string;

  @Prop({
    type: String,
    enum: DriverHirePaymentStatuses,
    default: DriverHirePaymentStatus.Pending,
  })
  paymentStatus: DriverHirePaymentStatus;

  @Prop({ type: DriverHirePricingSnapshotSchema, required: true })
  pricing: DriverHirePricingSnapshot;

  @Prop({ required: true })
  estimatedAmount: number;

  @Prop()
  finalAmount?: number;

  @Prop({ required: true })
  termsVersion: string;

  @Prop({ required: true })
  termsAcceptedAt: Date;

  @Prop({ required: true })
  vehicleRoadworthyConfirmed: boolean;

  @Prop({ required: true })
  vehicleInsuredConfirmed: boolean;

  @Prop({ required: true })
  vehicleAuthorizationConfirmed: boolean;

  @Prop({ type: DriverChangeRequestSchema })
  driverChangeRequest?: DriverChangeRequest;

  @Prop({ default: 0 })
  overtimeMinutes?: number;

  @Prop({ default: 0 })
  overtimeAmount?: number;

  @Prop()
  rescheduledAt?: Date;

  @Prop()
  assignedAt?: Date;

  @Prop()
  driverEnRouteAt?: Date;

  @Prop()
  driverArrivedAt?: Date;

  @Prop()
  startedAt?: Date;

  @Prop({ select: false })
  handoverCodeHash?: string;

  @Prop({ select: false })
  handoverCodeExpiresAt?: Date;

  @Prop({ select: false, default: 0 })
  handoverCodeAttempts?: number;

  @Prop()
  handoverCodeGeneratedAt?: Date;

  @Prop()
  handoverVerifiedAt?: Date;

  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS })
  handoverVerifiedBy?: UserDocument | string;

  @Prop()
  endedAt?: Date;

  @Prop()
  cancelledAt?: Date;

  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS })
  cancelledBy?: UserDocument | string;

  @Prop()
  cancellationReason?: string;

  @Prop()
  rejectionReason?: string;

  @Prop()
  adminNotes?: string;

  @Prop({ type: SchemaTypes.Mixed })
  paymentResponse?: unknown;

  @Prop()
  paymentError?: string;
}

export const DriverHireBookingSchema =
  SchemaFactory.createForClass(DriverHireBooking);

DriverHireBookingSchema.index({ user: 1, scheduledAt: -1 });
DriverHireBookingSchema.index(
  { user: 1, clientRequestId: 1 },
  {
    unique: true,
    partialFilterExpression: { clientRequestId: { $type: 'string' } },
  },
);
DriverHireBookingSchema.index({ assignedDriver: 1, scheduledAt: 1, status: 1 });
DriverHireBookingSchema.index({ status: 1, scheduledAt: 1 });
