import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';
import { BaseSchema, EmbeddedSchema, Schema } from '../../shared/base.schema';
import { DB_TABLES } from '../../shared/constants';
import { Document } from '../../shared/types';
import { UserDocument } from './user.schema';

export type DriverHireSettingsDocument = DriverHireSettings & Document;

export enum DriverHirePlanType {
  Hourly = 'Hourly',
  Weekly = 'Weekly',
  Monthly = 'Monthly',
  PremiumMonthly = 'PremiumMonthly',
}

export const DriverHirePlanTypes = Object.values(DriverHirePlanType);

@EmbeddedSchema()
export class DriverHirePlan {
  @Prop({ required: true, default: true })
  enabled: boolean;

  @Prop({ required: true, min: 0 })
  baseRate: number;

  @Prop({ required: true, default: 0, min: 0, max: 100 })
  discountPercent: number;

  @Prop({ required: true, default: 1, min: 1, max: 31 })
  includedDays: number;

  @Prop({ required: true, default: 8, min: 1, max: 24 })
  hoursPerDay: number;

  @Prop({ required: true, default: 1, min: 1, max: 366 })
  validityDays: number;

  @Prop({ required: true, default: 0, min: 0 })
  overtimeHourlyRate: number;

  @Prop({ required: true, default: 30, min: 5, max: 60 })
  overtimeBillingIncrementMinutes: number;
}

export const DriverHirePlanSchema =
  SchemaFactory.createForClass(DriverHirePlan);

@Schema()
export class DriverHireSettings extends BaseSchema {
  @Prop({ required: true, default: 'default', unique: true })
  key: string;

  @Prop({ required: true, default: false })
  active: boolean;

  @Prop({ required: true, default: 0 })
  hourlyRate: number;

  @Prop({ required: true, default: 2 })
  minimumHours: number;

  @Prop({ required: true, default: 30 })
  billingIncrementMinutes: number;

  @Prop({ required: true, default: 0 })
  logisticsFee: number;

  @Prop({ required: true, default: 2 })
  minimumAdvanceHours: number;

  @Prop({ required: true, default: 24 })
  rescheduleNoticeHours: number;

  @Prop({ default: true })
  supportsBookingRequestIdempotency?: boolean;

  @Prop({ type: DriverHirePlanSchema })
  hourlyPlan?: DriverHirePlan;

  @Prop({ type: DriverHirePlanSchema })
  weeklyPlan?: DriverHirePlan;

  @Prop({ type: DriverHirePlanSchema })
  monthlyPlan?: DriverHirePlan;

  @Prop({ type: DriverHirePlanSchema })
  premiumMonthlyPlan?: DriverHirePlan;

  @Prop({ required: true, default: '2026-11-05' })
  termsVersion: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS })
  updatedBy?: UserDocument | string;
}

export const DriverHireSettingsSchema =
  SchemaFactory.createForClass(DriverHireSettings);
