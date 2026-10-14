import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { BaseSchema, EmbeddedSchema, Schema } from '../../shared/base.schema';
import { Document } from '../../shared/types';

@EmbeddedSchema()
export class VehicleColour {
  /** Shown to drivers, e.g. "Champagne". */
  @Prop({ required: true, trim: true })
  label: string;

  /** Stored on the driver's vehicle, e.g. "champagne". */
  @Prop({ required: true, trim: true })
  value: string;

  /** Swatch shown next to the name, e.g. "#f7e7ce". */
  @Prop({ trim: true, lowercase: true })
  hex?: string;
}

export const VehicleColourSchema = SchemaFactory.createForClass(VehicleColour);

export type VehicleSettingsDocument = VehicleSettings & Document;

/**
 * Options for the vehicle step of driver onboarding that aren't part of the make/model
 * catalogue. There is one document, with key "default".
 */
@Schema()
export class VehicleSettings extends BaseSchema {
  @Prop({ required: true, default: 'default', unique: true })
  key: string;

  @Prop({ type: [VehicleColourSchema], default: [] })
  colours: VehicleColour[];

  /** Let drivers type a make, model or colour that isn't on the list. */
  @Prop({ default: true })
  allowOther: boolean;

  /**
   * When the starter makes and models were added. Seeding runs once, so a model an
   * admin removes doesn't come back on the next deploy.
   */
  @Prop()
  catalogueSeededAt?: Date;
}

export const VehicleSettingsSchema =
  SchemaFactory.createForClass(VehicleSettings);
