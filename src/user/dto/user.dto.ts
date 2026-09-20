import { Transform } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsPhoneNumber,
  IsString,
  IsUrl,
} from 'class-validator';
import { PaginationRequestDTO } from '../../shared/pagination.dto';
import { PayoutDestinationType } from '../../database/schemas/payout-request.schema';

export class ApplyReferralDTO {
  @IsString()
  @IsNotEmpty()
  referralCode: string;
}

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

  @IsPhoneNumber('NG')
  @IsOptional()
  phoneNumber?: string;

  @IsString()
  @IsOptional()
  phoneOtp?: string;

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

export class UpsertPushTokenDTO {
  @IsString()
  @IsNotEmpty()
  token: string;

  @IsIn(['ios', 'android'])
  platform: 'ios' | 'android';

  @IsIn(['rider', 'driver'])
  app: 'rider' | 'driver';
}

export class RemovePushTokenDTO {
  @IsString()
  @IsNotEmpty()
  token: string;
}

export class DeleteAccountDTO {
  @Equals(true, { message: 'account deletion must be confirmed' })
  confirm: true;

  @IsEnum(PayoutDestinationType)
  @IsOptional()
  destinationType?: PayoutDestinationType;

  @IsMongoId()
  @IsOptional()
  bankAccountId?: string;
}

export class SetUserVerificationDTO {
  @IsBoolean()
  @IsNotEmpty()
  isVerified: boolean;
}

export class AdminGetDriversDTO extends PaginationRequestDTO {
  /**
   * Query strings arrive as "true"/"false". Nest's enableImplicitConversion
   * turns Boolean("false") into true before field transforms — read the raw
   * query value from `obj` instead.
   */
  @Transform(({ obj }) => {
    const value = (obj as { verified?: unknown })?.verified;
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    if (value === true || value === 'true' || value === '1') {
      return true;
    }
    if (value === false || value === 'false' || value === '0') {
      return false;
    }
    return value;
  })
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
