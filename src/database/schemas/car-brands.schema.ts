import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { BaseSchema } from '../../shared/base.schema';
import { Document } from '../../shared/types';

export type CarBrandDocument = Document & CarBrand;

// Include "id" in API responses (the admin edits and deletes by it). "_id" stays too,
// because the rider app's hire screen reads catalogue rows as they are.
@Schema({ toJSON: { virtuals: true }, toObject: { virtuals: true } })
export class CarBrand extends BaseSchema {
  @Prop({ required: true })
  manufacturer: string;

  @Prop({ required: true })
  brand: string;

  @Prop({ required: true })
  year: number;
}

export const CarBrandSchema = SchemaFactory.createForClass(CarBrand);
