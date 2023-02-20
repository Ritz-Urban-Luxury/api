import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';
import { BaseSchema } from 'src/shared/base.schema';
import { DB_TABLES } from 'src/shared/constants';
import { Document } from 'src/shared/types';
import { UserDocument } from './user.schema';

export type CardDocument = Document & Card;

export class Card extends BaseSchema {
  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS })
  user: string | UserDocument;

  @Prop({ default: false })
  isDefault: boolean;
}

export const CardSchema = SchemaFactory.createForClass(Card);
