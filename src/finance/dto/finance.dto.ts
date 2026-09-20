import { Type } from 'class-transformer';
import {
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { PayoutDestinationType } from '../../database/schemas/payout-request.schema';

export class ResolveBankAccountDTO {
  @IsString()
  @IsNotEmpty()
  bankCode: string;

  @IsString()
  @IsNotEmpty()
  bankName: string;

  @IsString()
  @IsNotEmpty()
  accountNumber: string;
}

export class CreateDriverPayoutDTO {
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  amount: number;

  @IsMongoId()
  bankAccountId: string;
}

export class CreateDriverDebtPaymentDTO {
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  amount: number;
}

export class ReviewPayoutDTO {
  @IsString()
  @IsOptional()
  reason?: string;
}

export class UpdateFinancialSettingsDTO {
  @Type(() => Number)
  @IsNumber()
  @Min(1000)
  @IsOptional()
  driverCashDebtLimit?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  @IsOptional()
  driverMinimumDepositPercent?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @IsOptional()
  driverMinimumPayout?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(168)
  @IsOptional()
  driverSettlementDelayHours?: number;
}

export class AccountClosureDestinationDTO {
  @IsEnum(PayoutDestinationType)
  @IsOptional()
  destinationType?: PayoutDestinationType;

  @IsMongoId()
  @IsOptional()
  bankAccountId?: string;
}
