import {
  IsIn,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsNumber,
  IsString,
} from 'class-validator';
import { RideType, RideTypes } from 'src/database/schemas/rides.schema';

export class GetRidesDTO {
  @IsLatitude()
  @IsNotEmpty()
  lat: number;

  @IsLongitude()
  @IsNotEmpty()
  lon: number;
}

export class GetRideQuoteDTO {
  @IsNumber()
  @IsNotEmpty()
  distance: number;
}

export class RequestRideDTO {
  @IsIn(RideTypes)
  @IsNotEmpty()
  type: RideType;

  @IsLatitude()
  @IsNotEmpty()
  fromLat: number;

  @IsLongitude()
  @IsNotEmpty()
  fromLon: number;

  @IsLatitude()
  @IsNotEmpty()
  toLat: number;

  @IsLongitude()
  @IsNotEmpty()
  toLon: number;

  @IsString()
  @IsNotEmpty()
  fromAddress: string;

  @IsString()
  @IsNotEmpty()
  toAddress: string;
}

export class AcceptRideDTO {
  @IsString()
  @IsNotEmpty()
  trackingId: string;
}

export class MessageDTO {
  @IsString()
  @IsNotEmpty()
  text: string;
}