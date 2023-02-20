import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';
import { Schema } from 'src/shared/base.schema';
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
}

export const TripStatuses = Object.values(TripStatus);

@Schema()
export class Trip {
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
}

export const TripSchema = SchemaFactory.createForClass(Trip);
