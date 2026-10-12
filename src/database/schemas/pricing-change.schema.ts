import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';
import { BaseSchema, Schema } from '../../shared/base.schema';
import { DB_TABLES } from '../../shared/constants';
import { Document } from '../../shared/types';
import { UserDocument } from './user.schema';

export type PricingChangeDocument = PricingChange & Document;

export enum PricingChangeAction {
  Updated = 'updated',
  Created = 'created',
  Deleted = 'deleted',
}

/**
 * One saved edit to ride pricing, kept for audits and fare disputes. Edits to a
 * location name it in `zoneName`; edits to the default rates leave it empty.
 */
@Schema()
export class PricingChange extends BaseSchema {
  @Prop({
    type: String,
    enum: Object.values(PricingChangeAction),
    default: PricingChangeAction.Updated,
  })
  action: PricingChangeAction;

  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.PRICING_ZONES })
  zone?: string;

  @Prop()
  zoneName?: string;

  /** Empty when a location was created. */
  @Prop({ type: SchemaTypes.Mixed })
  before?: Record<string, unknown>;

  /** Empty when a location was deleted. */
  @Prop({ type: SchemaTypes.Mixed })
  after?: Record<string, unknown>;

  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS, required: true })
  changedBy: string | UserDocument;
}

export const PricingChangeSchema = SchemaFactory.createForClass(PricingChange);

PricingChangeSchema.index({ createdAt: -1 });
