import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';
import { BaseSchema, Schema } from '../../shared/base.schema';
import { DB_TABLES } from '../../shared/constants';
import { Document } from '../../shared/types';
import { UserDocument } from './user.schema';

export type ReferralDocument = Referral & Document;

export enum ReferralStatus {
  Pending = 'Pending',
  Paid = 'Paid',
}

export const ReferralStatuses = Object.values(ReferralStatus);

@Schema()
export class Referral extends BaseSchema {
  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS, required: true })
  inviter: string | UserDocument;

  @Prop({
    type: SchemaTypes.ObjectId,
    ref: DB_TABLES.USERS,
    required: true,
    unique: true,
  })
  invitee: string | UserDocument;

  @Prop({ default: 0 })
  houseRevenue: number;

  @Prop({ required: true })
  bonusAmount: number;

  @Prop({
    type: String,
    enum: ReferralStatuses,
    default: ReferralStatus.Pending,
  })
  status: ReferralStatus;

  @Prop()
  paidAt?: Date;
}

export const ReferralSchema = SchemaFactory.createForClass(Referral);

ReferralSchema.index({ inviter: 1, status: 1 });
ReferralSchema.index({ invitee: 1 }, { unique: true });
