import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';
import { BaseSchema, Schema } from 'src/shared/base.schema';
import { DB_TABLES } from 'src/shared/constants';
import { Document } from 'src/shared/types';
import { UserDocument } from './user.schema';
import { Location, LocationSchema, RidesDocument } from './rides.schema';
import { PaymentMethod } from './trips.schema';

export enum RentalBillingType {
  Hourly = 'Hourly',
  Daily = 'Daily',
}

export enum RentalStatus {
  Pending = 'Pending',
  Accepted = 'Accepted',
  InProgress = 'InProgress',
  Completed = 'Completed',
  Cancelled = 'Cancelled',
  Rejected = 'Rejected',
}

export const RentalBillingTypes = Object.values(RentalBillingType);
export const RentalStatuses = Object.values(RentalStatus);

export type RentalDocument = Document & Rental;

@Schema()
export class Rental extends BaseSchema {
  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS })
  user: string | UserDocument;

  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS })
  driver: string | UserDocument;

  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.RIDES })
  ride: string | RidesDocument;

  @Prop({ type: String, enum: RentalBillingTypes, required: true })
  billingType: RentalBillingType;

  @Prop({ type: String, required: true })
  paymentMethod: PaymentMethod | string;

  @Prop({ required: true })
  price: number;

  /** Hire fee only (rate × duration units), before caution/insurance. */
  @Prop({ type: Number, default: 0 })
  hireFee: number;

  /** Refundable caution held at booking (20% of hireFee). */
  @Prop({ type: Number, default: 0 })
  cautionAmount: number;

  /** Optional insurance charged at booking (not refunded on Complete). */
  @Prop({ type: Number, default: 0 })
  insuranceFee: number;

  @Prop()
  checkInAt: Date;

  @Prop()
  checkOutAt: Date;

  @Prop({ type: String, default: RentalStatus.Pending, enum: RentalStatuses })
  status: RentalStatus;

  @Prop()
  startedAt?: Date;

  @Prop()
  endedAt?: Date;

  @Prop({ type: Number, default: 0 })
  refundedAmount?: number;

  @Prop()
  refundedAt?: Date;

  /** Set when caution is returned to the rider on Complete. */
  @Prop()
  cautionRefundedAt?: Date;

  /** Set when Complete settlement (caution refund + owner earning) finishes. */
  @Prop()
  settledAt?: Date;

  @Prop({ type: SchemaTypes.Mixed })
  meta?: Record<string, unknown>;

  @Prop({ type: LocationSchema, required: true })
  from: Location;

  // @Prop({ type: LocationSchema, required: true })
  // to: Location;
}

export const RentalSchema = SchemaFactory.createForClass(Rental);
