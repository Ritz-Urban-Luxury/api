import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** Naira amounts. Limits catch typos (e.g. an extra zero) rather than set business rules. */
export class RideTypeRatesDTO {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  baseFare: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000)
  perKm: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000)
  perMinute: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  minimumFare: number;
}

export class UpdatePricingDTO {
  @ValidateNested()
  @Type(() => RideTypeRatesDTO)
  classic: RideTypeRatesDTO;

  @ValidateNested()
  @Type(() => RideTypeRatesDTO)
  luxury: RideTypeRatesDTO;

  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(90)
  commissionPercent: number;
}

/** A place with its own prices: a circle around a centre point. */
export class PricingZoneDTO {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name: string;

  @IsLatitude()
  latitude: number;

  @IsLongitude()
  longitude: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.2)
  @Max(150)
  radiusKm: number;

  @ValidateNested()
  @Type(() => RideTypeRatesDTO)
  classic: RideTypeRatesDTO;

  @ValidateNested()
  @Type(() => RideTypeRatesDTO)
  luxury: RideTypeRatesDTO;

  @IsBoolean()
  active: boolean;
}
