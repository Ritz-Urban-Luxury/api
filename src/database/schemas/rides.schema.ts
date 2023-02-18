import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';
import { UserDocument } from 'src/database/schemas/user.schema';
import { Schema } from 'src/shared/base.schema';
import { DB_TABLES } from 'src/shared/constants';
import { Document } from 'src/shared/types';

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

@Schema({ _id: false, timestamps: false })
export class Location {
  @Prop({ required: true })
  type: 'Point';

  @Prop([{ type: Number, maxlength: 2 }])
  coordinates: [number, number];
}

export const LocationSchema = SchemaFactory.createForClass(Location);

@Schema()
export class Ride {
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
