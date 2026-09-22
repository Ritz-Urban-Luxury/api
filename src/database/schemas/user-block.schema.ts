import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';
import { BaseSchema, Schema } from '../../shared/base.schema';
import { DB_TABLES } from '../../shared/constants';
import { Document } from '../../shared/types';
import { TripDocument } from './trips.schema';
import { UserDocument } from './user.schema';

export type UserBlockDocument = UserBlock & Document;

@Schema()
export class UserBlock extends BaseSchema {
  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS, required: true })
  blocker: UserDocument | string;

  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS, required: true })
  blocked: UserDocument | string;

  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.TRIPS })
  sourceTrip?: TripDocument | string;

  @Prop({ default: true })
  active: boolean;

  @Prop()
  unblockedAt?: Date;
}

export const UserBlockSchema = SchemaFactory.createForClass(UserBlock);

UserBlockSchema.index({ blocker: 1, blocked: 1 }, { unique: true });
UserBlockSchema.index({ blocker: 1, active: 1, createdAt: -1 });
UserBlockSchema.index({ blocked: 1, active: 1 });
