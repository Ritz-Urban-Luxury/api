import { Prop, SchemaFactory } from '@nestjs/mongoose';
import * as moment from 'moment';
import { SchemaTypes } from 'mongoose';
import { BaseSchema, Schema } from 'src/shared/base.schema';
import { Document } from 'src/shared/types';

@Schema()
export class AuthToken extends BaseSchema {
  @Prop()
  token: string;

  @Prop({ type: SchemaTypes.Mixed, default: {} })
  meta: Record<string, unknown>;

  @Prop({ default: false })
  isUsed?: boolean;

  @Prop({ default: false })
  isRevoked?: boolean;

  @Prop()
  expiresAt?: Date;

  expired?: boolean;
}

export type AuthTokenDocument = AuthToken & Document;

export const AuthTokenSchema = SchemaFactory.createForClass(AuthToken);

AuthTokenSchema.virtual('expired').get(function isTokenExpired() {
  const $this = this as AuthTokenDocument;

  return $this.expiresAt && moment().isAfter($this.expiresAt);
});
