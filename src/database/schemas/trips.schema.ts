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
import { BaseSchema, EmbeddedSchema, Schema } from '../../shared/base.schema';
import { DB_TABLES } from '../../shared/constants';
import { Document } from '../../shared/types';
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

export enum TripStopStatus {
  Pending = 'Pending',
  InProgress = 'InProgress',
  Completed = 'Completed',
}

export enum PaymentMethod {
  Cash = 'Cash',
  RULBalance = 'RULBalance',
  Card = 'Card',
}

export const TripStatuses = Object.values(TripStatus);
export const TripStopStatuses = Object.values(TripStopStatus);
export const InactiveTripStatuses = [
  TripStatus.Cancelled,
  TripStatus.Completed,
  TripStatus.PaymentFailed,
];
export const PaymentMethods = Object.values(PaymentMethod);

@EmbeddedSchema()
export class Rating {
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

@EmbeddedSchema()
export class TripStop {
  @Prop({ type: LocationSchema, required: true })
  to: Location;

  @Prop({ required: true })
  toAddress: string;

  @Prop({
    type: String,
    enum: TripStopStatuses,
    default: TripStopStatus.Pending,
  })
  status?: TripStopStatus;

  @Prop()
  distance?: number;
}

export const TripStopSchema = SchemaFactory.createForClass(TripStop);

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

  @Prop([{ type: TripStopSchema }])
  tripStops: TripStop[];

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

  nextDestination?: { to: Location; toAddress: string };
}

export const TripSchema = SchemaFactory.createForClass(Trip);

TripSchema.virtual('nextDestination').get(function getNextDestination() {
  const res = this.tripStops.find(
    (stop) => stop.status === TripStopStatus.InProgress,
  ) || { to: this.to, toAddress: this.toAddress };

  return res;
});
