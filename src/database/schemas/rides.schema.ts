import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';
import { UserDocument } from '../../database/schemas/user.schema';
import { BaseSchema, Schema } from '../../shared/base.schema';
import { DB_TABLES } from '../../shared/constants';
import { Document } from '../../shared/types';

export type RidesDocument = Ride & Document;

export enum RideStatus {
  Busy = 'Busy',
  Offline = 'Offline',
  Online = 'Online',
  FinishingTrip = 'FinishingTrip',
}

export enum RideType {
  Classic = 'Classic',
  Luxury = 'Luxury',
}

export const RideStatuses = Object.values(RideStatus);
export const RideTypes = Object.values(RideType);

@Schema({
  _id: false,
  timestamps: false,
  toJSON: {
    virtuals: true,
    transform(_doc: unknown, ret: Location): void {
      delete ret.deleted;
    },
  },
})
export class Location extends BaseSchema {
  @Prop({ required: true })
  type: 'Point';

  @Prop([{ type: Number, maxlength: 2 }])
  coordinates: [number, number];
}

export const LocationSchema = SchemaFactory.createForClass(Location);

@Schema()
export class Ride extends BaseSchema {
  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS, required: true })
  driver: UserDocument | string;

  @Prop({ required: true })
  model: string;

  @Prop({ required: true })
  color: string;

  @Prop({ required: true })
  registration: string;

  @Prop({ type: LocationSchema })
  location?: Location;

  @Prop({ type: String, enum: RideType, required: true })
  type: RideType;

  @Prop({ type: String, enum: RideStatuses, default: RideStatus.Offline })
  status?: RideStatus;
}

export const RideSchema = SchemaFactory.createForClass(Ride);

RideSchema.index({ location: '2dsphere' });
