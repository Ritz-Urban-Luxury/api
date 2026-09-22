import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';
import { BaseSchema, Schema } from '../../shared/base.schema';
import { DB_TABLES } from '../../shared/constants';
import { Document } from '../../shared/types';
import { MessageDocument } from './messages.schema';
import { TripDocument } from './trips.schema';
import { UserDocument } from './user.schema';

export type UserReportDocument = UserReport & Document;

export enum UserReportReason {
  AbusiveLanguage = 'AbusiveLanguage',
  Harassment = 'Harassment',
  InappropriateContent = 'InappropriateContent',
  PaymentIssue = 'PaymentIssue',
  SafetyConcern = 'SafetyConcern',
  Fraud = 'Fraud',
  Other = 'Other',
}

export const UserReportReasons = Object.values(UserReportReason);

export enum UserReportStatus {
  Open = 'Open',
  Reviewing = 'Reviewing',
  Resolved = 'Resolved',
  Dismissed = 'Dismissed',
}

export const UserReportStatuses = Object.values(UserReportStatus);

@Schema()
export class UserReport extends BaseSchema {
  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS, required: true })
  reporter: UserDocument | string;

  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS, required: true })
  reportedUser: UserDocument | string;

  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.TRIPS, required: true })
  trip: TripDocument | string;

  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.MESSAGES })
  message?: MessageDocument | string;

  @Prop({ type: String, enum: UserReportReasons, required: true })
  reason: UserReportReason;

  @Prop({ maxlength: 1000, trim: true })
  details?: string;

  @Prop({
    type: String,
    enum: UserReportStatuses,
    default: UserReportStatus.Open,
  })
  status: UserReportStatus;

  @Prop({ default: false })
  blockedUser: boolean;
}

export const UserReportSchema = SchemaFactory.createForClass(UserReport);

UserReportSchema.index({ reporter: 1, trip: 1, createdAt: -1 });
UserReportSchema.index({ reportedUser: 1, status: 1, createdAt: -1 });
