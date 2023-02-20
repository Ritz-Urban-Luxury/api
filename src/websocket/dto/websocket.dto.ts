import {
  IsLatitude,
  IsLongitude,
  IsMongoId,
  IsNotEmpty,
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
}
