import {
  IsLatitude,
  IsLongitude,
  IsMongoId,
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

  @IsMongoId()
  @IsNotEmpty()
  ride: string;

  @IsNumber()
  @Max(360)
  @Min(0)
  @IsOptional()
  heading?: number;
}
