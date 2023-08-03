import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { compare, hash } from 'bcryptjs';
import { SchemaTypes } from 'mongoose';
import { BaseSchema, Schema } from '../../shared/base.schema';
import { Document } from '../../shared/types';

export enum OAuthProvider {
  Google = 'Google',
  Facebook = 'Facebook',
}

export const OAuthProviders = Object.values(OAuthProvider);

export type UserDocument = User &
  Document & {
    isValidPassword(password: string): Promise<boolean>;
  };

@Schema({
  toJSON: {
    virtuals: true,
    transform(_doc: unknown, ret: UserDocument): void {
      delete ret._id;
      delete ret.__v;
      delete ret.password;
      delete ret.oAuthIdentifier;
      delete ret.oAuthProvider;
      delete ret.preferences;
    },
  },
})
export class User extends BaseSchema {
  @Prop()
  firstName: string;

  @Prop()
  lastName: string;

  @Prop()
  phoneNumber?: string;

  @Prop()
  email: string;

  @Prop({ required: true })
  password?: string;

  @Prop()
  avatar?: string;

  @Prop()
  license?: string;

  @Prop([{ type: String }])
  languages: string[];

  @Prop()
  oAuthIdentifier?: string;

  @Prop({ type: String, enum: OAuthProviders })
  oAuthProvider?: OAuthProvider;

  @Prop({ type: SchemaTypes.Mixed, default: {} })
  preferences: Record<string, unknown>;

  @Prop()
  city?: string;

  @Prop()
  vehiclesInFleet?: string;

  @Prop()
  licenseNumber?: string;

  @Prop()
  licenseExpiry?: Date;

  @Prop()
  isVerified?: boolean;

  @Prop()
  billingType?: string;

  @Prop()
  companyName?: string;

  @Prop()
  address?: string;

  @Prop()
  registrationCode?: string;

  @Prop()
  vatNumber?: string;

  @Prop()
  bankHolderName?: string;

  @Prop()
  bank?: string;

  @Prop()
  accountNumber?: string;
}

export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) {
    next();
    return;
  }

  const values = this as UserDocument;
  const hashed = await hash(values.password, 8);
  values.password = hashed;
  next();
});

UserSchema.method(
  'isValidPassword',
  async function isValidPassword(candidatePassword) {
    const values = this as UserDocument;
    return compare(candidatePassword, values.password);
  },
);
