import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  SupportComplaintSource,
  SupportComplaintSources,
  SupportComplaintStatus,
  SupportComplaintStatuses,
} from '../../database/schemas/support-complaint.schema';
import { PaginationRequestDTO } from '../../shared/pagination.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const trimLower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class CreateSupportComplaintDTO {
  @Transform(trimLower)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  message: string;

  @IsIn(SupportComplaintSources)
  @IsOptional()
  source?: SupportComplaintSource;

  @Transform(trim)
  @IsString()
  @MaxLength(100)
  @IsOptional()
  issue?: string;

  @Transform(trim)
  @IsString()
  @MaxLength(100)
  @IsOptional()
  topic?: string;

  @Transform(trim)
  @IsString()
  @MaxLength(64)
  @IsOptional()
  tripId?: string;
}

export class AdminGetSupportComplaintsDTO extends PaginationRequestDTO {
  @IsIn(SupportComplaintStatuses)
  @IsOptional()
  status?: SupportComplaintStatus;
}

export class AdminUpdateSupportComplaintDTO {
  @IsIn(SupportComplaintStatuses)
  @IsNotEmpty()
  status: SupportComplaintStatus;

  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  adminNote?: string;
}
