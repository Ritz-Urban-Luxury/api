/* eslint-disable max-classes-per-file */
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsIn,
  IsLatitude,
  IsLongitude,
  MaxLength,
  Max,
  Min,
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
  UserReportReason,
  UserReportReasons,
  UserReportStatus,
  UserReportStatuses,
} from '../../database/schemas/user-report.schema';

/** Max photos for a vehicle listing (Hire and trip cars). */
export const MAX_HIRE_RIDE_IMAGES = 6;
import {
  RentalBillingType,
  RentalBillingTypes,
  RentalStatus,
  RentalStatuses,
} from 'src/database/schemas/rentals.schema';
import { PaginationRequestDTO } from 'src/shared/pagination.dto';
import {
  RideApprovalStatus,
  RideApprovalStatuses,
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

export class ReportTripUserDTO {
  @IsIn(UserReportReasons)
  @IsNotEmpty()
  reason: UserReportReason;

  @IsString()
  @MaxLength(1000)
  @IsOptional()
  details?: string;

  @IsMongoId()
  @IsOptional()
  messageId?: string;

  @IsBoolean()
  @IsOptional()
  blockUser?: boolean;
}

export class RatePassengerDTO {
  @IsNumber()
  @Min(1)
  @Max(5)
  rating: number;

  @IsString()
  @IsOptional()
  comment?: string;
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
  paymentMethod: PaymentMethod | string;

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

  @IsArray()
  @ArrayMaxSize(MAX_HIRE_RIDE_IMAGES)
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

  @IsArray()
  @ArrayMaxSize(MAX_HIRE_RIDE_IMAGES)
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

  /** Required for trip vehicles and Hire cars when selecting a specific ride. */
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

  @IsIn(RideApprovalStatuses)
  @IsOptional()
  approvalStatus?: RideApprovalStatus;

  @IsString()
  @IsOptional()
  brand?: string;
}

export class AdminUpdateFleetApprovalDTO {
  @IsIn([RideApprovalStatus.Approved, RideApprovalStatus.Rejected])
  @IsNotEmpty()
  status: RideApprovalStatus.Approved | RideApprovalStatus.Rejected;

  @IsString()
  @IsOptional()
  reason?: string;
}

export class OwnerUpdateRentalStatusDTO {
  @IsIn(RentalStatuses)
  @IsNotEmpty()
  status: RentalStatus;
}

export class CancelRentalDTO {
  @IsString()
  @MaxLength(300)
  @IsOptional()
  reason?: string;
}

export class AdminGetTripsDTO extends PaginationRequestDTO {
  @IsIn(TripStatuses, { each: true })
  @IsOptional()
  status?: TripStatus | TripStatus[];
}

export class AdminGetUserReportsDTO extends PaginationRequestDTO {
  @IsIn(UserReportReasons)
  @IsOptional()
  reason?: UserReportReason;

  @IsIn(UserReportStatuses)
  @IsOptional()
  status?: UserReportStatus;
}

export class AdminUpdateUserReportDTO {
  @IsIn(UserReportStatuses)
  @IsNotEmpty()
  status: UserReportStatus;
}

export class GetTripHistoryDTO extends PaginationRequestDTO {
  @IsIn(['driver', 'rider'])
  @IsOptional()
  role?: 'driver' | 'rider';
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
