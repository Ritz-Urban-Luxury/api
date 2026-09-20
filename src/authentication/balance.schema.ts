import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';
import { UserDocument } from '../database/schemas/user.schema';
import { BaseSchema, Schema } from '../shared/base.schema';
import { DB_TABLES } from '../shared/constants';
import { Document } from '../shared/types';

export type BalanceDocument = Balance & Document;

@Schema()
export class Balance extends BaseSchema {
  @Prop({ required: true, type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS })
  user: string | UserDocument;

  @Prop({ default: 0 })
  amount: number;

  /** Cash-backed funds that can be returned during account closure. */
  @Prop()
  cashAmount?: number;

  /** Non-withdrawable promotional and referral ride credit. */
  @Prop({ default: 0 })
  rideCreditAmount?: number;

  /** Cash-backed funds reserved for an in-flight withdrawal. */
  @Prop({ default: 0 })
  reservedAmount?: number;
}

export const BalanceSchema = SchemaFactory.createForClass(Balance);
