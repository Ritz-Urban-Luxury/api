import { Type } from 'class-transformer';
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
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  accuracy?: number;

  @Type(() => Number)
  @IsLatitude()
  @IsNotEmpty()
  lat: number;

  @Type(() => Number)
  @IsLongitude()
  @IsNotEmpty()
  lon: number;

  @Type(() => Number)
  @IsNumber()
  @Max(360)
  @Min(0)
  @IsOptional()
  heading?: number;

  @IsDateString()
  @IsOptional()
  recordedAt?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  sequence?: number;

  @Type(() => Number)
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
