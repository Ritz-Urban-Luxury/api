import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';
import { BaseSchema, Schema } from '../../shared/base.schema';
import { DB_TABLES } from '../../shared/constants';
import { Document } from '../../shared/types';
import { UserDocument } from './user.schema';

export type PayoutRequestDocument = PayoutRequest & Document;

export enum PayoutRequestType {
  RiderAccountClosure = 'RiderAccountClosure',
  DriverEarnings = 'DriverEarnings',
}

export enum PayoutDestinationType {
  BankAccount = 'BankAccount',
  OriginalPaymentMethod = 'OriginalPaymentMethod',
}

export enum PayoutRequestStatus {
  Requested = 'Requested',
  Approved = 'Approved',
  Processing = 'Processing',
  ActionRequired = 'ActionRequired',
  Paid = 'Paid',
  Rejected = 'Rejected',
  FailedRetryable = 'FailedRetryable',
  Reversed = 'Reversed',
}

export const ActivePayoutRequestStatuses = [
  PayoutRequestStatus.Requested,
  PayoutRequestStatus.Approved,
  PayoutRequestStatus.Processing,
  PayoutRequestStatus.ActionRequired,
  PayoutRequestStatus.FailedRetryable,
];

@Schema()
export class PayoutRequest extends BaseSchema {
  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS, required: true })
  user: string | UserDocument;

  @Prop({ type: String, enum: Object.values(PayoutRequestType), required: true })
  type: PayoutRequestType;

  @Prop({ type: String, enum: Object.values(PayoutRequestStatus), required: true })
  status: PayoutRequestStatus;

  @Prop({ type: String, enum: Object.values(PayoutDestinationType), required: true })
  destinationType: PayoutDestinationType;

  /** Amount payable to the customer/driver in kobo. */
  @Prop({ required: true })
  amountKobo: number;

  @Prop({ default: 0 })
  debtOffsetKobo?: number;

  @Prop({ default: 0 })
  expiredRideCreditKobo?: number;

  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.BANK_ACCOUNTS })
  bankAccount?: string;

  /** Immutable payout destination and claimant details. */
  @Prop({ type: SchemaTypes.Mixed, required: true })
  destinationSnapshot: Record<string, unknown>;

  @Prop()
  notificationEmail?: string;

  @Prop()
  notificationPhone?: string;

  @Prop({ required: true, unique: true })
  publicReference: string;

  @Prop({ required: true })
  providerReference: string;

  @Prop()
  providerTransactionReference?: string;

  @Prop()
  providerTransferCode?: string;

  @Prop()
  providerRefundId?: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS })
  reviewedBy?: string | UserDocument;

  @Prop()
  reviewedAt?: Date;

  @Prop()
  rejectionReason?: string;

  @Prop()
  failureReason?: string;

  @Prop()
  paidAt?: Date;

  @Prop({ type: SchemaTypes.Mixed, default: {} })
  providerMeta?: Record<string, unknown>;
}

export const PayoutRequestSchema = SchemaFactory.createForClass(PayoutRequest);

PayoutRequestSchema.index({ user: 1, createdAt: -1 });
PayoutRequestSchema.index({ type: 1, status: 1, createdAt: -1 });
PayoutRequestSchema.index(
  { user: 1, type: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ActivePayoutRequestStatuses },
    },
  },
);
