import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { BaseSchema, Schema } from '../../shared/base.schema';
import { Document } from '../../shared/types';

export type CarBrandLogoDocument = Document & CarBrandLogo;

@Schema()
export class CarBrandLogo extends BaseSchema {
  @Prop({ required: true, trim: true })
  name: string;

  // Lowercase alphanumeric form of name, used to match ride brands to logos.
  @Prop({ required: true, index: true })
  slug: string;

  @Prop({ required: true, trim: true })
  logoUrl: string;
}

export const CarBrandLogoSchema = SchemaFactory.createForClass(CarBrandLogo);
