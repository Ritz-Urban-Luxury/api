/* eslint-disable max-classes-per-file */
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDate,
  IsIn,
  IsLatitude,
  IsLongitude,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsObject,
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
  RentalStatuses,
} from 'src/database/schemas/rentals.schema';
import { PaginationRequestDTO } from 'src/shared/pagination.dto';
import {
  RideType,
  RideTypes,
  RideStatus,
  RideStatuses,
} from '../../database/schemas/rides.schema';
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

export class GetDrivingRouteDTO {
  @Type(() => Number)
  @IsLatitude()
  @IsNotEmpty()
  fromLat: number;

  @Type(() => Number)
  @IsLongitude()
  @IsNotEmpty()
  fromLon: number;

  @Type(() => Number)
  @IsLatitude()
  @IsNotEmpty()
  toLat: number;

  @Type(() => Number)
  @IsLongitude()
  @IsNotEmpty()
  toLon: number;
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

  @IsIn(RideTypes)
  @IsOptional()
  type?: RideType;

  @IsObject()
  @IsOptional()
  specs?: Record<string, unknown>;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  hourlyRate?: number;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  dailyRate?: number;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  insuranceFee?: number;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  cautionDeposit?: number;

  @ValidateNested()
  @Type(() => LocationDTO)
  @IsOptional()
  location?: LocationDTO;
}

export class UpdateRideDTO {
  @IsString()
  @IsOptional()
  model?: string;

  @IsString()
  @IsOptional()
  brand?: string;

  @IsString()
  @IsOptional()
  registration?: string;

  @IsString()
  @IsOptional()
  color?: string;

  @IsString({ each: true })
  @IsOptional()
  images?: string[];

  @IsIn(RideTypes)
  @IsOptional()
  type?: RideType;

  @IsObject()
  @IsOptional()
  specs?: Record<string, unknown>;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  hourlyRate?: number;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  dailyRate?: number;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  insuranceFee?: number;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  cautionDeposit?: number;

  @ValidateNested()
  @Type(() => LocationDTO)
  @IsOptional()
  location?: LocationDTO;
}

/** Explicit Online/Offline — idempotent when the same status is sent again. */
export class SetRideAvailabilityDTO {
  @IsIn([RideStatus.Online, RideStatus.Offline])
  @IsNotEmpty()
  status: RideStatus.Online | RideStatus.Offline;

  /** Required for Hire cars; Classic trip toggle may omit and use the owner's trip vehicle. */
  @IsMongoId()
  @IsOptional()
  rideId?: string;
}

export class GetMyRidesDTO {
  @IsIn(RideTypes)
  @IsOptional()
  type?: RideType;
}

export class AdminGetFleetDTO extends PaginationRequestDTO {
  @IsIn(RideTypes)
  @IsOptional()
  type?: RideType;

  @IsIn(RideStatuses)
  @IsOptional()
  status?: RideStatus;

  @IsString()
  @IsOptional()
  brand?: string;
}

export class OwnerUpdateRentalStatusDTO {
  @IsIn(RentalStatuses)
  @IsNotEmpty()
  status: RentalStatus;
}

export class AdminGetTripsDTO extends PaginationRequestDTO {
  @IsIn(TripStatuses, { each: true })
  @IsOptional()
  status?: TripStatus | TripStatus[];
}

export class AdminGetRentalsDTO extends PaginationRequestDTO {
  @IsIn(RentalStatuses, { each: true })
  @IsOptional()
  status?: RentalStatus | RentalStatus[];
}

export class AdminUpdateRentalStatusDTO {
  @IsIn(RentalStatuses)
  @IsNotEmpty()
  status: RentalStatus;
}

export class AdminRefundRentalDTO {
  @IsNumber()
  @IsOptional()
  amount?: number;
}

export class DriverEarningsQueryDTO {
  @IsIn(['daily', 'weekly', 'monthly'])
  @IsOptional()
  timeRange?: 'daily' | 'weekly' | 'monthly';

  @IsString()
  @IsOptional()
  period?: string;
}

export class DriverActivityQueryDTO {
  @IsIn(['week', 'months'])
  @IsOptional()
  period?: 'week' | 'months';
}
