import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';
import { BaseSchema, Schema } from '../../shared/base.schema';
import { DB_TABLES } from '../../shared/constants';
import { Document } from '../../shared/types';
import { UserDocument } from './user.schema';

export type CardDocument = Document & Card;

@Schema()
export class Card extends BaseSchema {
  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS })
  user: string | UserDocument;

  @Prop({ default: false })
  isDefault: boolean;

  @Prop({ required: true })
  provider: string;

  @Prop({ required: true })
  email: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  lastFour: string;

  @Prop({ required: true })
  brand: string;

  @Prop({ required: true })
  expiryMonth: string;

  @Prop({ required: true })
  expiryYear: string;

  @Prop({ type: SchemaTypes.Mixed, default: {} })
  meta: Record<string, unknown>;
}

export const CardSchema = SchemaFactory.createForClass(Card);
