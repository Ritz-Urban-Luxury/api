import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';
import { UserDocument } from '../database/schemas/user.schema';
import { BaseSchema, Schema } from '../shared/base.schema';
import { DB_TABLES } from '../shared/constants';
import { Document } from '../shared/types';

export type BalanceDocument = Balance & Document;

@Schema()
export class Balance extends BaseSchema {
  @Prop({ required: true, type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS })
  user: string | UserDocument;

  @Prop({ default: 0 })
  amount: number;
}

export const BalanceSchema = SchemaFactory.createForClass(Balance);
