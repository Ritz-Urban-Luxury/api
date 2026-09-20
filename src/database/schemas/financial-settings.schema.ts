import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';
import { BaseSchema, Schema } from '../../shared/base.schema';
import { DB_TABLES } from '../../shared/constants';
import { Document } from '../../shared/types';
import { UserDocument } from './user.schema';

export type FinancialSettingsDocument = FinancialSettings & Document;

@Schema()
export class FinancialSettings extends BaseSchema {
  @Prop({ required: true, default: 'default', unique: true })
  key: string;

  /** Driver commission debt limit in kobo. */
  @Prop({ required: true, default: 5_000_000 })
  driverCashDebtLimitKobo: number;

  @Prop({ required: true, default: 25 })
  driverMinimumDepositPercent: number;

  @Prop({ required: true, default: 100_000 })
  driverMinimumPayoutKobo: number;

  @Prop({ required: true, default: 24 })
  driverSettlementDelayHours: number;

  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS })
  updatedBy?: string | UserDocument;
}

export const FinancialSettingsSchema =
  SchemaFactory.createForClass(FinancialSettings);
