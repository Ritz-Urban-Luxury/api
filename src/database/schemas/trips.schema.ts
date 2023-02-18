import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';
import { UserDocument } from 'src/database/schemas/user.schema';
import { Schema } from 'src/shared/base.schema';
import { DB_TABLES } from 'src/shared/constants';
import { Document } from 'src/shared/types';
import { RidesDocument } from './rides.schema';

export type TripDocument = Trip & Document;

export enum TripStatus {
  InProgress = 'InProgress',
  Cancelled = 'Cancelled',
  Completed = 'Completed',
}

export const TripStatuses = Object.values(TripStatus);

@Schema()
export class Trip {
  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS, required: true })
  user: UserDocument | string;

  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS, required: true })
  driver: UserDocument | string;

  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.RIDES, required: true })
  ride: RidesDocument | string;

  @Prop({ type: String, enum: TripStatuses, default: TripStatus.InProgress })
  status?: TripStatus;

  @Prop()
  cancellationReason?: string;
}

export const TripSchema = SchemaFactory.createForClass(Trip);
