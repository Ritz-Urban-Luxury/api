import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';
import { BaseSchema, Schema } from '../../shared/base.schema';
import { DB_TABLES } from '../../shared/constants';
import { Document } from '../../shared/types';
import { UserDocument } from './user.schema';

export type DriverHireTermsAcceptanceDocument = DriverHireTermsAcceptance &
  Document;

@Schema()
export class DriverHireTermsAcceptance extends BaseSchema {
  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS, required: true })
  user: UserDocument | string;

  @Prop({ required: true })
  version: string;

  @Prop({ required: true })
  acceptedAt: Date;
}

export const DriverHireTermsAcceptanceSchema = SchemaFactory.createForClass(
  DriverHireTermsAcceptance,
);

DriverHireTermsAcceptanceSchema.index(
  { user: 1, version: 1 },
  { unique: true },
);
