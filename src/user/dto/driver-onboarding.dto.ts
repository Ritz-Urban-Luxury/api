import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  VehicleCategories,
  VehicleCategory,
} from '../../database/schemas/rides.schema';

export class DriverOnboardingVehicleDTO {
  @IsIn(VehicleCategories)
  @IsOptional()
  category?: VehicleCategory = VehicleCategory.Classic;

  @IsString()
  @IsNotEmpty()
  brand: string;

  @IsString()
  @IsNotEmpty()
  model: string;

  @IsString()
  @IsNotEmpty()
  registration: string;

  @IsString()
  @IsNotEmpty()
  color: string;

  @IsString()
  @IsNotEmpty()
  year: string;

  @IsInt()
  @Min(2)
  @Max(8)
  seats: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @IsUrl({}, { each: true })
  exteriorImages: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @IsUrl({}, { each: true })
  interiorImages: string[];
}

export class CompleteDriverOnboardingDTO {
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @IsString()
  @IsNotEmpty()
  lastName: string;

  @IsUrl()
  avatar: string;

  @IsIn(['camera', 'library'])
  avatarSource: 'camera' | 'library';

  @IsUrl()
  license: string;

  @IsString()
  @IsNotEmpty()
  licenseNumber: string;

  @IsDateString()
  licenseExpiry: string;

  @IsString()
  @IsNotEmpty()
  address: string;

  @IsString()
  @IsNotEmpty()
  bankHolderName: string;

  @IsString()
  @IsNotEmpty()
  bank: string;

  @IsString()
  @IsNotEmpty()
  accountNumber: string;

  @IsString()
  @IsOptional()
  companyName?: string;

  @IsString()
  @IsOptional()
  registrationCode?: string;

  @IsString()
  @IsOptional()
  vatNumber?: string;

  @IsString()
  @IsOptional()
  referralCode?: string;

  @ValidateNested()
  @Type(() => DriverOnboardingVehicleDTO)
  vehicle: DriverOnboardingVehicleDTO;
}
