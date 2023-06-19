import {
  IsBoolean,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export class RideLocationDTO {
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
}

export class DriverETADTO {
  @IsBoolean()
  @IsOptional()
  ignoreETA?: boolean;
}
