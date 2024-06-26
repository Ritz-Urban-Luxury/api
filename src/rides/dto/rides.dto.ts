/* eslint-disable max-classes-per-file */
import {
  IsArray,
  IsDate,
  IsIn,
  IsLatitude,
  IsLongitude,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  registerDecorator,
  isLatLong,
} from 'class-validator';
import {
  RentalBillingType,
  RentalBillingTypes,
  RentalStatus,
} from 'src/database/schemas/rentals.schema';
import { PaginationRequestDTO } from 'src/shared/pagination.dto';
import { RideType, RideTypes } from '../../database/schemas/rides.schema';
import {
  PaymentMethod,
  PaymentMethods,
  Rating,
  TripStatus,
  TripStatuses,
} from '../../database/schemas/trips.schema';

@ValidatorConstraint()
class IsCoordinatesConstraint {
  validate(value: [number, number]) {
    if (!Array.isArray(value) || value.length !== 2) {
      return false;
    }

    return isLatLong(value.join(','));
  }

  defaultMessage(validationArguments?: ValidationArguments) {
    return `${validationArguments.property} must be a valid coordinate of format [lat, lon]`;
  }
}

const IsCoordinates =
  (validationOptions?: ValidationOptions) =>
  (object: unknown, propertyName: string) => {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsCoordinatesConstraint,
    });
  };

export class GetRidesDTO {
  @IsLatitude()
  @IsNotEmpty()
  lat: number;

  @IsLongitude()
  @IsNotEmpty()
  lon: number;

  @IsIn(RideTypes, { each: true })
  @IsOptional()
  type?: RideType;

  @IsNumber()
  @IsOptional()
  radius?: number;
}

export class GetRideQuoteDTO {
  @IsNumber()
  @IsNotEmpty()
  distance: number;
}

export class RideStopsDTO {
  @IsLatitude()
  @IsNotEmpty()
  toLat: number;

  @IsLongitude()
  @IsNotEmpty()
  toLon: number;

  @IsString()
  @IsNotEmpty()
  toAddress: string;
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

  @IsIn(PaymentMethods)
  @IsNotEmpty()
  paymentMethod: PaymentMethod;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  stops: RideStopsDTO[];
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

export class UpdateTripDTO {
  @IsIn([TripStatus.DriverArrived, TripStatus.InProgress, TripStatus.Completed])
  @IsOptional()
  status?: TripStatus;

  @ValidateNested()
  @IsOptional()
  rating?: Rating;

  @ValidateNested({ each: true })
  @IsOptional()
  stops?: RideStopsDTO[];
}

export class LocationDTO {
  @IsIn(['Point'])
  @IsNotEmpty()
  type: 'Point';

  @IsNumber()
  @IsOptional()
  heading: number;

  @IsString()
  @IsNotEmpty()
  address: string;

  @IsCoordinates()
  @IsNotEmpty()
  coordinates: [number, number];
}

export class HireRideDTO {
  @IsMongoId()
  @IsNotEmpty()
  ride: string;

  @IsIn(RentalBillingTypes)
  @IsNotEmpty()
  billingType: RentalBillingType;

  @IsDate()
  @IsOptional()
  checkInAt?: Date;

  @IsDate()
  @IsOptional()
  checkOutAt?: Date;

  @IsString()
  @IsNotEmpty()
  paymentMethod: PaymentMethod;

  @ValidateNested()
  @IsNotEmpty()
  from: LocationDTO;

  // @ValidateNested()
  // @IsNotEmpty()
  // to: LocationDTO;
}

export class CreateRideDTO {
  @IsString()
  @IsNotEmpty()
  model: string;

  @IsString()
  @IsNotEmpty()
  brand: string;

  @IsString()
  @IsNotEmpty()
  registration: string;

  @IsString()
  @IsNotEmpty()
  color: string;

  @IsString({ each: true })
  @IsOptional()
  images?: string[];
}

export class UpdateRideDTO {
  @IsString({ each: true })
  @IsOptional()
  images?: string[];
}

export class AdminGetTripsDTO extends PaginationRequestDTO {
  @IsIn(TripStatuses, { each: true })
  @IsOptional()
  status?: TripStatus | TripStatus[];
}

export class AdminGetRentalsDTO extends PaginationRequestDTO {
  @IsIn(TripStatuses, { each: true })
  @IsOptional()
  status?: RentalStatus | RentalStatus[];
}
