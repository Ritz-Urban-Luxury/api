import { Type, Transform } from 'class-transformer';
import {
  ArrayMaxSize,
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
  @Matches(/^(RULBalance|[a-fA-F0-9]{24})$/, {
    message: 'paymentMethod must be Ritz Balance or a saved card',
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
}

export class UpdateInHouseDriverDTO {
  @IsBoolean()
  eligible: boolean;
}
