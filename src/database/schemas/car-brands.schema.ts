import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { BaseSchema } from '../../shared/base.schema';
import { Document } from '../../shared/types';

export type CarBrandDocument = Document & CarBrand;

@Schema()
export class CarBrand extends BaseSchema {
  @Prop({ required: true })
  manufacturer: string;

  @Prop({ required: true })
  brand: string;

  @Prop({ required: true })
  year: number;
}

export const CarBrandSchema = SchemaFactory.createForClass(CarBrand);
