import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';
import { BaseSchema, Schema } from '../../shared/base.schema';
import { DB_TABLES } from '../../shared/constants';
import { Document } from '../../shared/types';
import { TripDocument } from './trips.schema';
import { UserDocument } from './user.schema';

export type DriverLedgerEntryDocument = DriverLedgerEntry & Document;

export enum DriverLedgerType {
  CommissionOwed = 'CommissionOwed',
  Adjustment = 'Adjustment',
}

export const DriverLedgerTypes = Object.values(DriverLedgerType);

@Schema()
export class DriverLedgerEntry extends BaseSchema {
  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS, required: true })
  driver: string | UserDocument;

  @Prop({
    type: SchemaTypes.ObjectId,
    ref: DB_TABLES.TRIPS,
  })
  trip?: string | TripDocument;

  @Prop({ type: String, enum: DriverLedgerTypes, required: true })
  type: DriverLedgerType;

  /** Positive amount means the driver owes the platform. */
  @Prop({ required: true })
  amount: number;

  @Prop({ required: true, default: () => new Date() })
  earnedAt: Date;
}

export const DriverLedgerEntrySchema =
  SchemaFactory.createForClass(DriverLedgerEntry);

DriverLedgerEntrySchema.index({ driver: 1, earnedAt: -1 });
DriverLedgerEntrySchema.index(
  { trip: 1, type: 1 },
  { unique: true, partialFilterExpression: { trip: { $type: 'objectId' } } },
);
