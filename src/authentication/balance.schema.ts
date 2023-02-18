import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { SchemaTypes } from 'mongoose';
import { UserDocument } from 'src/database/schemas/user.schema';
import { BaseSchema, Schema } from 'src/shared/base.schema';
import { DB_TABLES } from 'src/shared/constants';
import { Document } from 'src/shared/types';

export type BalanceDocument = Balance & Document;

@Schema()
export class Balance extends BaseSchema {
  @Prop({ required: true, type: SchemaTypes.ObjectId, ref: DB_TABLES.USERS })
  user: string | UserDocument;

  @Prop({ default: 0 })
  amount: number;
}

export const BalanceSchema = SchemaFactory.createForClass(Balance);
