import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';
import { BaseSchema, Schema } from '../../shared/base.schema';
import { DB_TABLES } from '../../shared/constants';
import { Document } from '../../shared/types';
import { RideTypeRates, RideTypeRatesSchema } from './pricing-settings.schema';
import { UserDocument } from './user.schema';

export type PricingZoneDocument = PricingZone & Document;

/**
 * A place with its own ride prices, e.g. a city or an airport. A ride is priced by the
 * zone its pickup falls in; where zones overlap, the smallest one wins.
 */
@Schema()
export class PricingZone extends BaseSchema {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true })
  latitude: number;

  @Prop({ required: true })
  longitude: number;

  @Prop({ required: true })
  radiusKm: number;

  @Prop({ type: RideTypeRatesSchema, required: true })
  classic: RideTypeRates;

  @Prop({ type: RideTypeRatesSchema, required: true })
  luxury: RideTypeRates;

  /** Paused zones are kept but not used for pricing. */
  @Prop({ default: true })
  active: boolean;

  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS })
  updatedBy?: string | UserDocument;
}

export const PricingZoneSchema = SchemaFactory.createForClass(PricingZone);

PricingZoneSchema.index({ active: 1 });
