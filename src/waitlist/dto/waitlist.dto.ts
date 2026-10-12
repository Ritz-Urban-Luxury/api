import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { WaitlistRole } from '../../database/schemas/waitlist-entry.schema';

const trimOptional = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : value;

const trimLower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export enum WaitlistAudience {
  Rider = 'rider',
  Driver = 'driver',
  Both = 'both',
}

export class JoinWaitlistDTO {
  @Transform(trimLower)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @Transform(trimOptional)
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @IsEnum(WaitlistRole)
  role: WaitlistRole;

  @Transform(trimOptional)
  @IsOptional()
  @Matches(/^[a-z0-9-]{1,40}$/)
  source?: string;

  /** Honeypot. Hidden from people, so only bots fill it in. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}

export class WaitlistAudienceDTO {
  @IsEnum(WaitlistAudience)
  audience: WaitlistAudience;
}

export class ListWaitlistDTO {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsEnum(WaitlistRole)
  role?: WaitlistRole;

  @Transform(trimOptional)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
