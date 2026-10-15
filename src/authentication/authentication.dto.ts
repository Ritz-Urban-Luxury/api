import {
  IsEmail,
  IsIn,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsPhoneNumber,
  IsString,
} from 'class-validator';
import { OAuthProvider, OAuthProviders } from '../database/schemas/user.schema';

export class SignupDTO {
  @IsPhoneNumber('NG')
  @IsOptional()
  phoneNumber?: string;

  @IsString()
  @IsOptional()
  phoneOtp?: string;

  @IsString()
  @IsOptional()
  oAuthIdentifier?: string;

  @IsIn(OAuthProviders)
  @IsOptional()
  oAuthProvider?: OAuthProvider;

  @IsEmail()
  @IsOptional()
  email: string;

  @IsString()
  @IsOptional()
  emailOtp?: string;

  @IsString()
  @IsOptional()
  firstName: string;

  @IsOptional()
  @IsString()
  lastName: string;

  @IsOptional()
  @IsIn(['android', 'web', 'ios'])
  platform?: string;

  @IsString()
  @IsOptional()
  city?: string;

  @IsMongoId()
  @IsOptional()
  serviceLocation?: string;

  @IsString()
  @IsOptional()
  vehiclesInFleet?: string;
}

export class DriverSignupDTO {
  @IsPhoneNumber('NG')
  @IsNotEmpty()
  phoneNumber: string;

  @IsString()
  @IsNotEmpty()
  phoneOtp: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsMongoId()
  @IsNotEmpty()
  locationId: string;

  @IsString()
  @IsOptional()
  vehiclesInFleet?: string;
}

export class RequestPhoneOTPDTO {
  @IsPhoneNumber('NG')
  @IsNotEmpty()
  phoneNumber: string;

  @IsIn(['rider', 'driver'])
  @IsOptional()
  app?: 'rider' | 'driver';
}

export class RequestEmailOTPDTO {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsOptional()
  name?: string;
}

export class LoginDTO {
  @IsPhoneNumber('NG')
  @IsOptional()
  phoneNumber?: string;

  @IsString()
  @IsOptional()
  otp?: string;

  @IsString()
  @IsOptional()
  identifier?: string;

  @IsString()
  @IsOptional()
  password?: string;

  @IsIn(['rider', 'driver'])
  @IsOptional()
  app?: 'rider' | 'driver';
}

export class ResetPasswordDTO {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  otp: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}
