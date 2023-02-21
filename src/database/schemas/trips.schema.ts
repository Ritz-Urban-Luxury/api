import { Prop, SchemaFactory } from '@nestjs/mongoose';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { SchemaTypes } from 'mongoose';
import { BaseSchema, Schema } from 'src/shared/base.schema';
import { DB_TABLES } from 'src/shared/constants';
import { Document } from 'src/shared/types';
import { Location, LocationSchema, RidesDocument } from './rides.schema';
import { UserDocument } from './user.schema';

export type TripDocument = Trip & Document;

export enum TripStatus {
  InProgress = 'InProgress',
  Started = 'Started',
  Cancelled = 'Cancelled',
  Completed = 'Completed',
  DriverArrived = 'DriverArrived',
  PaymentFailed = 'PaymentFailed',
}

export enum PaymentMethod {
  Cash = 'Cash',
  RULBalance = 'RULBalance',
  Card = 'Card',
}

export const TripStatuses = Object.values(TripStatus);
export const InactiveTripStatuses = [
  TripStatus.Cancelled,
  TripStatus.Completed,
  TripStatus.PaymentFailed,
];
export const PaymentMethods = Object.values(PaymentMethod);

@Schema({
  _id: false,
  timestamps: false,
  toJSON: {
    virtuals: true,
    transform(_doc: unknown, ret: Rating): void {
      delete ret.deleted;
    },
  },
})
export class Rating extends BaseSchema {
  @Prop()
  @IsNumber()
  @Min(1)
  @Max(5)
  @IsNotEmpty()
  rating: number;

  @Prop()
  @IsString()
  @IsOptional()
  comment: string;
}

export const RatingSchema = SchemaFactory.createForClass(Rating);

@Schema()
export class Trip extends BaseSchema {
  @Prop({ required: true })
  amount: number;

  @Prop({ type: LocationSchema, required: true })
  from: Location;

  @Prop({ type: LocationSchema, required: true })
  to: Location;

  @Prop({ required: true })
  fromAddress: string;

  @Prop({ required: true })
  toAddress: string;

  @Prop({ required: true })
  distance: number;

  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS, required: true })
  user: UserDocument | string;

  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS, required: true })
  driver: UserDocument | string;

  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.RIDES, required: true })
  ride: RidesDocument | string;

  @Prop({ type: String, enum: TripStatuses, default: TripStatus.Started })
  status?: TripStatus;

  @Prop()
  cancellationReason?: string;

  @Prop({ type: String, enum: PaymentMethods, required: true })
  paymentMethod: PaymentMethod;

  @Prop({ type: SchemaTypes.Mixed })
  meta?: Record<string, unknown>;

  @Prop({ type: RatingSchema })
  rating: Rating;
}

export const TripSchema = SchemaFactory.createForClass(Trip);
