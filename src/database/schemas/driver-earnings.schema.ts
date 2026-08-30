import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';
import { BaseSchema, Schema } from '../../shared/base.schema';
import { DB_TABLES } from '../../shared/constants';
import { Document } from '../../shared/types';
import { TripDocument } from './trips.schema';
import { UserDocument } from './user.schema';

export type DriverEarningDocument = DriverEarning & Document;

@Schema()
export class DriverEarning extends BaseSchema {
  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS, required: true })
  driver: string | UserDocument;

  @Prop({
    type: SchemaTypes.ObjectId,
    ref: DB_TABLES.TRIPS,
    required: true,
    unique: true,
  })
  trip: string | TripDocument;

  /** Net amount paid to the driver (gross − commission). */
  @Prop({ required: true })
  amount: number;

  @Prop()
  grossAmount?: number;

  @Prop()
  commissionAmount?: number;

  @Prop({ type: String })
  paymentMethod?: string;

  @Prop({ required: true, default: () => new Date() })
  earnedAt: Date;
}

export const DriverEarningSchema = SchemaFactory.createForClass(DriverEarning);

DriverEarningSchema.index({ earnedAt: -1 });
