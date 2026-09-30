import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';
import { BaseSchema, Schema } from '../../shared/base.schema';
import { DB_TABLES } from '../../shared/constants';
import { Document } from '../../shared/types';
import { UserDocument } from './user.schema';

export enum NewsAudience {
  Rider = 'rider',
  Driver = 'driver',
  Both = 'both',
}

export enum NewsStatus {
  Draft = 'draft',
  Published = 'published',
  Archived = 'archived',
}

export type NewsArticleDocument = NewsArticle & Document;

@Schema()
export class NewsArticle extends BaseSchema {
  @Prop({ required: true, trim: true, unique: true })
  slug: string;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true, trim: true })
  summary: string;

  @Prop({ required: true, trim: true })
  body: string;

  @Prop({ trim: true })
  coverImageUrl?: string;

  @Prop({ type: String, enum: Object.values(NewsAudience), required: true })
  audience: NewsAudience;

  @Prop({
    type: String,
    enum: Object.values(NewsStatus),
    default: NewsStatus.Draft,
  })
  status: NewsStatus;

  @Prop()
  publishedAt?: Date;

  @Prop({ default: false })
  isDefault: boolean;

  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS })
  createdBy?: string | UserDocument;

  @Prop({ type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS })
  updatedBy?: string | UserDocument;
}

export const NewsArticleSchema = SchemaFactory.createForClass(NewsArticle);
NewsArticleSchema.index({ status: 1, audience: 1, publishedAt: -1 });
