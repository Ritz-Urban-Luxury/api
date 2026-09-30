import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';
import { BaseSchema, Schema } from '../../shared/base.schema';
import { DB_TABLES } from '../../shared/constants';
import { Document } from '../../shared/types';

export type NewsReadDocument = NewsRead & Document;

@Schema()
export class NewsRead extends BaseSchema {
  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS, required: true })
  user: string;

  @Prop({
    type: SchemaTypes.ObjectId,
    ref: DB_TABLES.NEWS_ARTICLES,
    required: true,
  })
  article: string;

  @Prop({ required: true, default: Date.now })
  readAt: Date;
}

export const NewsReadSchema = SchemaFactory.createForClass(NewsRead);
NewsReadSchema.index({ user: 1, article: 1 }, { unique: true });
