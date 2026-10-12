import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { BaseSchema, Schema } from '../../shared/base.schema';
import { Document } from '../../shared/types';

export enum WaitlistRole {
  Rider = 'rider',
  Driver = 'driver',
}

export type WaitlistEntryDocument = WaitlistEntry & Document;

@Schema()
export class WaitlistEntry extends BaseSchema {
  @Prop({ required: true, trim: true, lowercase: true })
  email: string;

  @Prop({ trim: true })
  name?: string;

  @Prop({ type: String, enum: Object.values(WaitlistRole), required: true })
  role: WaitlistRole;

  /** Where on the website they signed up, e.g. "home" or "download". */
  @Prop({ trim: true })
  source?: string;

  /** When they last agreed to be emailed about the launch. */
  @Prop({ required: true })
  consentedAt: Date;

  @Prop({ required: true, select: false })
  unsubscribeToken: string;

  @Prop()
  unsubscribedAt?: Date;

  /** Set only after the email provider accepts the launch email. */
  @Prop()
  notifiedAt?: Date;

  /** Temporary delivery lease. Stale leases are eligible for retry after a restart. */
  @Prop()
  notifyClaimedAt?: Date;

  @Prop()
  notifyError?: string;
}

export const WaitlistEntrySchema = SchemaFactory.createForClass(WaitlistEntry);

WaitlistEntrySchema.index({ email: 1 }, { unique: true });
WaitlistEntrySchema.index({ unsubscribeToken: 1 }, { unique: true });
WaitlistEntrySchema.index({
  role: 1,
  notifiedAt: 1,
  unsubscribedAt: 1,
  notifyClaimedAt: 1,
  createdAt: 1,
});
WaitlistEntrySchema.index({ createdAt: -1 });
