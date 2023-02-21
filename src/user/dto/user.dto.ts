import { IsEmail, IsOptional, IsString, IsUrl } from 'class-validator';

export class UpdateUserDTO {
  @IsString()
  @IsOptional()
  firstName: string;

  @IsString()
  @IsOptional()
  lastName: string;

  @IsEmail()
  @IsOptional()
  email: string;

  @IsString()
  @IsOptional()
  emailOtp: string;

  @IsUrl()
  @IsOptional()
  avatar?: string;
}
