import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';
import { BaseSchema, Schema } from '../../shared/base.schema';
import { DB_TABLES } from '../../shared/constants';
import { Document } from '../../shared/types';
import { UserDocument } from './user.schema';

export type DriverFinancialStateDocument = DriverFinancialState & Document;

@Schema()
export class DriverFinancialState extends BaseSchema {
  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS, required: true, unique: true })
  driver: string | UserDocument;

  @Prop({ default: false })
  restricted: boolean;

  @Prop({ default: 0 })
  restrictedDebtKobo: number;

  @Prop({ default: 0 })
  requiredDepositKobo: number;

  @Prop({ default: 0 })
  paidTowardRestrictionKobo: number;

  @Prop()
  restrictedAt?: Date;

  @Prop()
  releasedAt?: Date;
}

export const DriverFinancialStateSchema =
  SchemaFactory.createForClass(DriverFinancialState);
