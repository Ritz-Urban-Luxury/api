import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';
import { BaseSchema, Schema } from '../../shared/base.schema';
import { DB_TABLES } from '../../shared/constants';
import { Document } from '../../shared/types';
import { UserDocument } from './user.schema';

export type WalletTransactionDocument = WalletTransaction & Document;

export enum WalletTransactionType {
  CashCredit = 'CashCredit',
  RideCredit = 'RideCredit',
  Debit = 'Debit',
  Reserve = 'Reserve',
  Release = 'Release',
  WithdrawalPaid = 'WithdrawalPaid',
}

@Schema()
export class WalletTransaction extends BaseSchema {
  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS, required: true })
  user: string | UserDocument;

  @Prop({ type: String, enum: Object.values(WalletTransactionType), required: true })
  type: WalletTransactionType;

  /** Signed integer amount in kobo. */
  @Prop({ required: true })
  amountKobo: number;

  @Prop()
  purpose?: string;

  @Prop()
  provider?: string;

  @Prop()
  providerReference?: string;

  @Prop({ type: SchemaTypes.Mixed, default: {} })
  meta?: Record<string, unknown>;
}

export const WalletTransactionSchema =
  SchemaFactory.createForClass(WalletTransaction);

WalletTransactionSchema.index({ user: 1, createdAt: -1 });
WalletTransactionSchema.index(
  { provider: 1, providerReference: 1, type: 1 },
  {
    unique: true,
    partialFilterExpression: {
      providerReference: { $type: 'string' },
      provider: { $type: 'string' },
    },
  },
);
