import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export class RideLocationDTO {
  @IsNumber()
  @Min(0)
  @IsOptional()
  accuracy?: number;

  @IsLatitude()
  @IsNotEmpty()
  lat: number;

  @IsLongitude()
  @IsNotEmpty()
  lon: number;

  @IsNumber()
  @Max(360)
  @Min(0)
  @IsOptional()
  heading?: number;

  @IsDateString()
  @IsOptional()
  recordedAt?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  sequence?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  speed?: number;
}

export class DriverETADTO {
  @IsBoolean()
  @IsOptional()
  ignoreETA?: boolean;
}
