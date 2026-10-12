import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';
import { BaseSchema, EmbeddedSchema, Schema } from '../../shared/base.schema';
import { DB_TABLES } from '../../shared/constants';
import { Document } from '../../shared/types';
import { UserDocument } from './user.schema';

/** Prices for one ride type, in naira. */
@EmbeddedSchema()
export class RideTypeRates {
  /** Charged on every ride before distance and time. */
  @Prop({ required: true, default: 0 })
  baseFare: number;

  @Prop({ required: true })
  perKm: number;

  /** Charged for the expected driving time, so slow traffic is paid for. */
  @Prop({ required: true, default: 0 })
  perMinute: number;

  /** No ride costs less than this. */
  @Prop({ required: true })
  minimumFare: number;
}

export const RideTypeRatesSchema = SchemaFactory.createForClass(RideTypeRates);

export type PricingSettingsDocument = PricingSettings & Document;

/** Ride pricing set by admins. There is one document, with key "default". */
@Schema()
export class PricingSettings extends BaseSchema {
  @Prop({ required: true, default: 'default', unique: true })
  key: string;

  @Prop({ type: RideTypeRatesSchema, required: true })
  classic: RideTypeRates;

  @Prop({ type: RideTypeRatesSchema, required: true })
  luxury: RideTypeRates;

  /** Share of each fare Ritz keeps, as a percentage (20 = 20%). */
  @Prop({ required: true })
  commissionPercent: number;

  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS })
  updatedBy?: string | UserDocument;
}

export const PricingSettingsSchema =
  SchemaFactory.createForClass(PricingSettings);
