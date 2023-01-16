import {
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
}

export class RequestPhoneOTPDTO {
  @IsPhoneNumber('NG')
  @IsNotEmpty()
  phoneNumber: string;
}
