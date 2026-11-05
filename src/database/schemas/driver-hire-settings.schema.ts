import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';
import { BaseSchema, Schema } from '../../shared/base.schema';
import { DB_TABLES } from '../../shared/constants';
import { Document } from '../../shared/types';
import { UserDocument } from './user.schema';

export type DriverHireSettingsDocument = DriverHireSettings & Document;

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

  @Prop({ required: true, default: '2026-11-05' })
  termsVersion: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS })
  updatedBy?: UserDocument | string;
}

export const DriverHireSettingsSchema =
  SchemaFactory.createForClass(DriverHireSettings);
