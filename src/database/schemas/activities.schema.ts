import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';
import { BaseSchema, Schema } from '../../shared/base.schema';
import { DB_TABLES } from '../../shared/constants';
import { Document } from '../../shared/types';
import { TripDocument } from './trips.schema';
import { UserDocument } from './user.schema';

export type ActivityDocument = Activity & Document;

export enum ActivityType {
  UserRegistered = 'UserRegistered',
  PaymentSucceeded = 'PaymentSucceeded',
  PaymentFailed = 'PaymentFailed',
}

export const ActivityTypes = Object.values(ActivityType);

@Schema()
export class Activity extends BaseSchema {
  @Prop({ type: String, enum: ActivityTypes, required: true })
  type: ActivityType;

  @Prop({ required: true })
  title: string;

  @Prop()
  meta?: string;

  @Prop()
  amount?: number;

  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS })
  user?: string | UserDocument;

  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.TRIPS })
  trip?: string | TripDocument;
}

export const ActivitySchema = SchemaFactory.createForClass(Activity);

ActivitySchema.index({ createdAt: -1 });
ActivitySchema.index({ type: 1, createdAt: -1 });
