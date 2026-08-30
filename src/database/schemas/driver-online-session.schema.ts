import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';
import { BaseSchema, Schema } from '../../shared/base.schema';
import { DB_TABLES } from '../../shared/constants';
import { Document } from '../../shared/types';
import { RidesDocument } from './rides.schema';
import { UserDocument } from './user.schema';

export type DriverOnlineSessionDocument = DriverOnlineSession & Document;

@Schema()
export class DriverOnlineSession extends BaseSchema {
  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS, required: true })
  driver: string | UserDocument;

  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.RIDES, required: true })
  ride: string | RidesDocument;

  @Prop({ required: true, default: () => new Date() })
  startedAt: Date;

  @Prop()
  endedAt?: Date;
}

export const DriverOnlineSessionSchema =
  SchemaFactory.createForClass(DriverOnlineSession);

DriverOnlineSessionSchema.index({ driver: 1, startedAt: -1 });
DriverOnlineSessionSchema.index({ driver: 1, endedAt: 1 });
