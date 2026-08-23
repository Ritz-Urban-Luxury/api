import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
} from 'class-validator';
import { PaginationRequestDTO } from '../../shared/pagination.dto';

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

  @IsUrl()
  @IsOptional()
  license?: string;

  @IsString()
  @IsOptional()
  licenseNumber?: string;

  @IsDateString()
  @IsOptional()
  licenseExpiry?: string;

  @IsString()
  @IsOptional()
  billingType?: string;

  @IsString()
  @IsOptional()
  companyName?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  registrationCode?: string;

  @IsString()
  @IsOptional()
  vatNumber?: string;

  @IsString()
  @IsOptional()
  bankHolderName?: string;

  @IsString()
  @IsOptional()
  bank?: string;

  @IsString()
  @IsOptional()
  accountNumber?: string;
}

export class SetUserVerificationDTO {
  @IsBoolean()
  @IsNotEmpty()
  isVerified: boolean;
}

export class AdminGetDriversDTO extends PaginationRequestDTO {
  @IsBoolean()
  @IsOptional()
  verified?: boolean;
}

export class AdminListUsersDTO extends PaginationRequestDTO {
  @IsString()
  @IsOptional()
  search?: string;
}

export class SetUserAdminDTO {
  @IsBoolean()
  @IsNotEmpty()
  isAppAdmin: boolean;
}
