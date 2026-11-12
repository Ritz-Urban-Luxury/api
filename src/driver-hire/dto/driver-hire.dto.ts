import { Type, Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Matches,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  DriverHireBookingStatus,
  DriverHireTransmission,
} from '../../database/schemas/driver-hire-booking.schema';
import { DriverHirePlanType } from '../../database/schemas/driver-hire-settings.schema';
import { PaginationRequestDTO } from '../../shared/pagination.dto';

export class DriverHireLocationDTO {
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  address: string;

  @IsLatitude()
  latitude: number;

  @IsLongitude()
  longitude: number;
}

export class DriverHireVehicleDTO {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  make: string;

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  model: string;

  @IsInt()
  @Min(1980)
  @Max(2100)
  year: number;

  @IsString()
  @MinLength(2)
  @MaxLength(40)
  color: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(20)
  registration: string;

  @IsString()
  @MinLength(2)
  @MaxLength(40)
  vehicleType: string;

  @IsEnum(DriverHireTransmission)
  transmission: DriverHireTransmission;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  notes?: string;

  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  @IsOptional()
  photoUrl?: string;
}

export class AcceptDriverHireTermsDTO {
  @IsString()
  @IsNotEmpty()
  version: string;

  @IsBoolean()
  accepted: boolean;
}

export class CreateDriverHireBookingDTO {
  @IsDateString()
  scheduledAt: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(24)
  estimatedHours: number;

  @IsEnum(DriverHirePlanType)
  @IsOptional()
  planType?: DriverHirePlanType;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  @IsOptional()
  workingDays?: number[];

  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'dailyStartTime must use HH:mm format',
  })
  @IsOptional()
  dailyStartTime?: string;

  @ValidateNested()
  @Type(() => DriverHireLocationDTO)
  pickup: DriverHireLocationDTO;

  @ValidateNested()
  @Type(() => DriverHireLocationDTO)
  completion: DriverHireLocationDTO;

  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  @IsOptional()
  additionalStops?: string[];

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  servicePurpose: string;

  @IsString()
  @MaxLength(1000)
  @IsOptional()
  specialInstructions?: string;

  @ValidateNested()
  @Type(() => DriverHireVehicleDTO)
  vehicle: DriverHireVehicleDTO;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  handoverContactName: string;

  @IsString()
  @MinLength(7)
  @MaxLength(25)
  handoverContactPhone: string;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  returnContactName?: string;

  @IsString()
  @MaxLength(25)
  @IsOptional()
  returnContactPhone?: string;

  @IsInt()
  @Min(0)
  @Max(20)
  passengerCount: number;

  @IsString()
  @IsNotEmpty()
  @Equals('RULBalance', {
    message: 'paymentMethod must be Ritz Balance',
  })
  paymentMethod: string;

  @IsBoolean()
  vehicleRoadworthyConfirmed: boolean;

  @IsBoolean()
  vehicleInsuredConfirmed: boolean;

  @IsBoolean()
  vehicleAuthorizationConfirmed: boolean;
}

export class ListDriverHireBookingsDTO extends PaginationRequestDTO {
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsEnum(DriverHireBookingStatus)
  @IsOptional()
  status?: DriverHireBookingStatus;
}

export class CancelDriverHireBookingDTO {
  @IsString()
  @MaxLength(500)
  @IsOptional()
  reason?: string;
}

export class AssignDriverHireBookingDTO {
  @IsMongoId()
  driverId: string;

  @IsString()
  @MaxLength(1000)
  @IsOptional()
  adminNotes?: string;
}

export class RejectDriverHireBookingDTO {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}

export class UpdateDriverHireStatusDTO {
  @IsEnum(DriverHireBookingStatus)
  status: DriverHireBookingStatus;
}

export class VerifyDriverHireHandoverDTO {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must contain exactly 6 digits' })
  code: string;
}

export class DriverHirePlanDTO {
  @IsBoolean()
  enabled: boolean;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000_000)
  baseRate: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  discountPercent: number;

  @IsInt()
  @Min(1)
  @Max(31)
  includedDays: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(24)
  hoursPerDay: number;

  @IsInt()
  @Min(1)
  @Max(366)
  validityDays: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  overtimeHourlyRate: number;

  @IsInt()
  @Min(5)
  @Max(60)
  overtimeBillingIncrementMinutes: number;
}

export class UpdateDriverHireSettingsDTO {
  @IsBoolean()
  active: boolean;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  hourlyRate: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(24)
  minimumHours: number;

  @IsInt()
  @Min(5)
  @Max(60)
  billingIncrementMinutes: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  logisticsFee: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(168)
  minimumAdvanceHours: number;

  @IsInt()
  @Min(24)
  @Max(168)
  rescheduleNoticeHours: number;

  @ValidateNested()
  @Type(() => DriverHirePlanDTO)
  hourlyPlan: DriverHirePlanDTO;

  @ValidateNested()
  @Type(() => DriverHirePlanDTO)
  weeklyPlan: DriverHirePlanDTO;

  @ValidateNested()
  @Type(() => DriverHirePlanDTO)
  monthlyPlan: DriverHirePlanDTO;

  @ValidateNested()
  @Type(() => DriverHirePlanDTO)
  premiumMonthlyPlan: DriverHirePlanDTO;
}

export class RescheduleDriverHireDTO {
  @IsDateString()
  scheduledAt: string;
}

export class RequestDriverChangeDTO {
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  reason: string;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  note?: string;
}

export class ResolveDriverChangeDTO {
  @IsBoolean()
  approved: boolean;

  @IsMongoId()
  @IsOptional()
  driverId?: string;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  note?: string;
}

export class UpdateDriverHireOvertimeDTO {
  @IsInt()
  @Min(0)
  @Max(100_000)
  overtimeMinutes: number;
}

export class UpdateInHouseDriverDTO {
  @IsBoolean()
  eligible: boolean;
}
