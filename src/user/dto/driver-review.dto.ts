import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  DriverReviewField,
  DriverReviewFields,
  DriverReviewStatus,
} from '../../database/schemas/user.schema';
import {
  VehicleCategories,
  VehicleCategory,
} from '../../database/schemas/rides.schema';

export class DriverReviewIssueDTO {
  @IsIn(DriverReviewFields)
  field: DriverReviewField;

  @IsString()
  @MinLength(4)
  @MaxLength(500)
  reason: string;

  @IsString()
  @IsOptional()
  rideId?: string;
}

export class ReviewDriverApplicationDTO {
  @IsIn([
    DriverReviewStatus.Approved,
    DriverReviewStatus.ChangesRequested,
    DriverReviewStatus.Rejected,
  ])
  status:
    | DriverReviewStatus.Approved
    | DriverReviewStatus.ChangesRequested
    | DriverReviewStatus.Rejected;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DriverReviewIssueDTO)
  @IsOptional()
  issues?: DriverReviewIssueDTO[];

  @IsString()
  @IsOptional()
  vehicleId?: string;

  @IsIn(VehicleCategories)
  @IsOptional()
  vehicleCategory?: VehicleCategory;

  @IsString()
  @MaxLength(500)
  @IsOptional()
  reason?: string;
}

export class DriverReviewVehicleCorrectionDTO {
  @IsString()
  rideId: string;

  @IsString()
  @IsOptional()
  brand?: string;

  @IsString()
  @IsOptional()
  model?: string;

  @IsString()
  @IsOptional()
  color?: string;

  @IsString()
  @IsOptional()
  registration?: string;

  @IsArray()
  @IsUrl({}, { each: true })
  @IsOptional()
  images?: string[];
}

export class ResubmitDriverApplicationDTO {
  @IsUrl()
  @IsOptional()
  avatar?: string;

  @IsIn(['camera', 'library'])
  @IsOptional()
  avatarSource?: 'camera' | 'library';

  @IsUrl()
  @IsOptional()
  license?: string;

  @IsString()
  @IsOptional()
  licenseNumber?: string;

  @IsDateString()
  @IsOptional()
  licenseExpiry?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DriverReviewVehicleCorrectionDTO)
  @IsOptional()
  vehicles?: DriverReviewVehicleCorrectionDTO[];
}
