import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';
import { BaseSchema, Schema } from '../../shared/base.schema';
import { DB_TABLES } from '../../shared/constants';
import { Document } from '../../shared/types';
import { TripDocument } from './trips.schema';
import { UserDocument } from './user.schema';

export type DriverRideOfferDocument = DriverRideOffer & Document;

export enum RideOfferOutcome {
  Pending = 'Pending',
  Accepted = 'Accepted',
  TimedOut = 'TimedOut',
  CancelledByRider = 'CancelledByRider',
}

export const RideOfferOutcomes = Object.values(RideOfferOutcome);

@Schema()
export class DriverRideOffer extends BaseSchema {
  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS, required: true })
  driver: string | UserDocument;

  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS, required: true })
  user: string | UserDocument;

  @Prop({ required: true, unique: true })
  trackingId: string;

  @Prop({ required: true, default: () => new Date() })
  offeredAt: Date;

  @Prop({
    type: String,
    enum: RideOfferOutcomes,
    default: RideOfferOutcome.Pending,
  })
  outcome: RideOfferOutcome;

  @Prop()
  resolvedAt?: Date;

  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.TRIPS })
  trip?: string | TripDocument;
}

export const DriverRideOfferSchema =
  SchemaFactory.createForClass(DriverRideOffer);

DriverRideOfferSchema.index({ driver: 1, offeredAt: -1 });
DriverRideOfferSchema.index({ driver: 1, outcome: 1, offeredAt: -1 });
