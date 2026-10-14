import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { BaseSchema, Schema } from '../../shared/base.schema';
import { Document } from '../../shared/types';

export type ServiceLocationDocument = ServiceLocation & Document;

/** A city/market where Ritz currently accepts driver registrations. */
@Schema()
export class ServiceLocation extends BaseSchema {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true, lowercase: true, unique: true })
  code: string;

  @Prop({ default: 'Nigeria', trim: true })
  country: string;

  @Prop({ default: true })
  active: boolean;

  @Prop({ default: 0 })
  displayOrder: number;

  @Prop({ trim: true })
  inspectionAddress?: string;

  @Prop({ trim: true })
  inspectionMapUrl?: string;
}

export const ServiceLocationSchema =
  SchemaFactory.createForClass(ServiceLocation);

ServiceLocationSchema.index({ active: 1, displayOrder: 1, name: 1 });
