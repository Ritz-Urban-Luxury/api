import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';
import { BaseSchema, Schema } from '../../shared/base.schema';
import { DB_TABLES } from '../../shared/constants';
import { Document } from '../../shared/types';
import { TripDocument } from './trips.schema';
import { UserDocument } from './user.schema';

export type MessageDocument = Document & Message;

@Schema()
export class Message extends BaseSchema {
  @Prop({ required: true })
  text: string;

  @Prop({ type: SchemaTypes.ObjectId, required: true, ref: DB_TABLES.TRIPS })
  trip: string | TripDocument;

  @Prop({ type: SchemaTypes.ObjectId, required: true, ref: DB_TABLES.USERS })
  sender: string | UserDocument;
}

export const MessageSchema = SchemaFactory.createForClass(Message);
