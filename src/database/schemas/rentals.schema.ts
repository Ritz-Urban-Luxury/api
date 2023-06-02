import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';
import { BaseSchema, Schema } from 'src/shared/base.schema';
import { DB_TABLES } from 'src/shared/constants';
import { Document } from 'src/shared/types';
import { UserDocument } from './user.schema';
import { RidesDocument } from './rides.schema';
import { PaymentMethod, PaymentMethods } from './trips.schema';

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

  @Prop({ type: String, enum: PaymentMethods, required: true })
  paymentMethod: PaymentMethod;

  @Prop({ required: true })
  price: number;

  @Prop()
  checkInAt: Date;

  @Prop()
  checkOutAt: Date;

  @Prop({ type: String, default: RentalStatus.Pending, enum: RentalStatuses })
  status: RentalStatus;

  @Prop({ type: SchemaTypes.Mixed })
  meta?: Record<string, unknown>;
}

export const RentalSchema = SchemaFactory.createForClass(Rental);
