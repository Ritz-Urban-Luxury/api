import { Prop, SchemaFactory } from '@nestjs/mongoose';
import { compare, hash } from 'bcryptjs';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { BaseSchema, Schema } from 'src/shared/base.schema';
import { Document } from 'src/shared/types';

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
    },
  },
})
export class User extends BaseSchema {
  @IsString()
  @IsNotEmpty()
  @Prop({ required: true })
  firstName: string;

  @IsString()
  @IsNotEmpty()
  @Prop({ required: true })
  lastName: string;

  @IsString()
  @IsOptional()
  @Prop()
  phoneNumber?: string;

  @IsEmail()
  @IsOptional()
  @Prop()
  email: string;

  @IsString()
  @IsOptional()
  @Prop({ required: true })
  password?: string;

  @Prop()
  @IsString()
  @IsOptional()
  avatar?: string;

  @Prop()
  @IsString()
  @IsOptional()
  oAuthIdentifier?: string;

  @Prop({ type: String, enum: OAuthProviders })
  @IsIn(OAuthProviders)
  @IsOptional()
  oAuthProvider?: OAuthProvider;
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
