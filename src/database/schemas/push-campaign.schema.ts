import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';
import { BaseSchema, Schema } from '../../shared/base.schema';
import { DB_TABLES } from '../../shared/constants';
import { Document } from '../../shared/types';
import { UserDocument } from './user.schema';

export enum PushCampaignAudience {
  Rider = 'rider',
  Driver = 'driver',
  Both = 'both',
}

export enum PushCampaignStatus {
  Queued = 'queued',
  Sending = 'sending',
  Completed = 'completed',
  Failed = 'failed',
}

export type PushCampaignDocument = PushCampaign & Document;

@Schema()
export class PushCampaign extends BaseSchema {
  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true, trim: true })
  body: string;

  @Prop({
    type: String,
    enum: Object.values(PushCampaignAudience),
    required: true,
  })
  audience: PushCampaignAudience;

  @Prop()
  riderUrl?: string;

  @Prop()
  driverUrl?: string;

  @Prop({
    type: String,
    enum: Object.values(PushCampaignStatus),
    default: PushCampaignStatus.Queued,
  })
  status: PushCampaignStatus;

  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS, required: true })
  createdBy: string | UserDocument;

  @Prop({ required: true })
  scheduledAt: Date;

  @Prop()
  startedAt?: Date;

  @Prop()
  completedAt?: Date;

  @Prop({ default: 0 })
  targetedUsers: number;

  @Prop({ default: 0 })
  targetedDevices: number;

  @Prop({ default: 0 })
  accepted: number;

  @Prop({ default: 0 })
  failed: number;

  @Prop({ default: 0 })
  invalidTokens: number;

  @Prop()
  failureReason?: string;
}

export const PushCampaignSchema = SchemaFactory.createForClass(PushCampaign);

PushCampaignSchema.index({ status: 1, scheduledAt: 1, createdAt: 1 });
PushCampaignSchema.index({ createdAt: -1 });
