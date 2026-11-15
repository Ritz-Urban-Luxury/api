import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';
import { BaseSchema, Schema } from '../../shared/base.schema';
import { DB_TABLES } from '../../shared/constants';
import { Document } from '../../shared/types';
import { TripDocument } from './trips.schema';
import { UserDocument } from './user.schema';

export type SupportComplaintDocument = SupportComplaint & Document;

/** Shares the safety-report statuses so both tabs of the admin page behave the same. */
export enum SupportComplaintStatus {
  Open = 'Open',
  Reviewing = 'Reviewing',
  Resolved = 'Resolved',
  Dismissed = 'Dismissed',
}

export const SupportComplaintStatuses = Object.values(SupportComplaintStatus);

export enum SupportComplaintSource {
  RideHelp = 'ride_help',
  Support = 'support',
}

export const SupportComplaintSources = Object.values(SupportComplaintSource);

@Schema()
export class SupportComplaint extends BaseSchema {
  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS, required: true })
  user: UserDocument | string;

  /** Where Support should reply; may differ from the account email. */
  @Prop({ required: true, trim: true, lowercase: true, maxlength: 254 })
  email: string;

  @Prop({ required: true, trim: true, maxlength: 100 })
  name: string;

  @Prop({
    type: String,
    enum: SupportComplaintSources,
    default: SupportComplaintSource.Support,
  })
  source: SupportComplaintSource;

  /** Ride issue picked on the ride-help screen. */
  @Prop({ trim: true, maxlength: 100 })
  issue?: string;

  /** Optional topic picked on the general complaint screen. */
  @Prop({ trim: true, maxlength: 100 })
  topic?: string;

  /** Linked only when the trip belongs to the rider. */
  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.TRIPS })
  trip?: TripDocument | string;

  /** The reference the app sent, kept even when it could not be linked. */
  @Prop({ trim: true, maxlength: 64 })
  tripReference?: string;

  @Prop({ required: true, trim: true, maxlength: 5000 })
  message: string;

  @Prop({ default: false })
  safetyRelated: boolean;

  @Prop({
    type: String,
    enum: SupportComplaintStatuses,
    default: SupportComplaintStatus.Open,
  })
  status: SupportComplaintStatus;

  /** Internal note, only visible to admins. */
  @Prop({ trim: true, maxlength: 2000 })
  adminNote?: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS })
  handledBy?: UserDocument | string;

  @Prop()
  resolvedAt?: Date;
}

export const SupportComplaintSchema =
  SchemaFactory.createForClass(SupportComplaint);

SupportComplaintSchema.index({ status: 1, createdAt: -1 });
SupportComplaintSchema.index({ user: 1, createdAt: -1 });
