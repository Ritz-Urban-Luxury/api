import {
  IsEmail,
  IsIn,
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

  @IsString()
  @IsOptional()
  vehiclesInFleet?: string;
}

export class RequestPhoneOTPDTO {
  @IsPhoneNumber('NG')
  @IsNotEmpty()
  phoneNumber: string;
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
}
