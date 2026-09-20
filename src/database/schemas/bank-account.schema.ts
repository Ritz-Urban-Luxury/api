import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';
import { BaseSchema, Schema } from '../../shared/base.schema';
import { DB_TABLES } from '../../shared/constants';
import { Document } from '../../shared/types';
import { UserDocument } from './user.schema';

export type BankAccountDocument = BankAccount & Document;

export enum BankNameMatchStatus {
  Matched = 'Matched',
  Review = 'Review',
  Rejected = 'Rejected',
}

@Schema()
export class BankAccount extends BaseSchema {
  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS, required: true })
  user: string | UserDocument;

  @Prop({ required: true })
  bankCode: string;

  @Prop({ required: true })
  bankName: string;

  @Prop({ required: true })
  accountNumber: string;

  @Prop({ required: true })
  resolvedAccountName: string;

  @Prop({ type: String, enum: Object.values(BankNameMatchStatus), required: true })
  nameMatchStatus: BankNameMatchStatus;

  @Prop()
  recipientCode?: string;

  @Prop()
  verifiedAt?: Date;

  @Prop({ default: false })
  isDefault?: boolean;
}

export const BankAccountSchema = SchemaFactory.createForClass(BankAccount);

BankAccountSchema.index({ user: 1, bankCode: 1, accountNumber: 1 }, { unique: true });
BankAccountSchema.index({ user: 1, isDefault: 1 });
