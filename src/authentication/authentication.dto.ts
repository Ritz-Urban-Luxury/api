import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsPhoneNumber,
  IsString,
} from 'class-validator';

export class SignupDTO {
  @IsPhoneNumber('NG')
  @IsOptional()
  phoneNumber?: string;

  @IsString()
  @IsOptional()
  socialSignupId?: string;

  @IsString()
  @IsOptional()
  phoneOtp?: string;
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
