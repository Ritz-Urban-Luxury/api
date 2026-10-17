import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';
import { BaseSchema, Schema } from '../../shared/base.schema';
import { DB_TABLES } from '../../shared/constants';
import { Document } from '../../shared/types';
import { UserDocument } from './user.schema';

export type AdminAuditLogDocument = AdminAuditLog & Document;

export enum AdminAuditAction {
  TestAccountPurged = 'test-account.purged',
  AppReviewDataReset = 'app-review-data.reset',
  VehicleReviewed = 'vehicle.reviewed',
}

@Schema()
export class AdminAuditLog extends BaseSchema {
  @Prop({ type: String, enum: Object.values(AdminAuditAction), required: true })
  action: AdminAuditAction;

  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS, required: true })
  actor: string | UserDocument;

  // Stored as strings because a purge intentionally removes the target user.
  @Prop()
  targetUserId?: string;

  @Prop()
  targetIdentity?: string;

  @Prop({ required: true })
  reason: string;

  @Prop({ type: SchemaTypes.Mixed })
  meta?: Record<string, unknown>;
}

export const AdminAuditLogSchema = SchemaFactory.createForClass(AdminAuditLog);

AdminAuditLogSchema.index({ createdAt: -1 });
AdminAuditLogSchema.index({ actor: 1, createdAt: -1 });
