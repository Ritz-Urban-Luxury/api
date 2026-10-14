import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateServiceLocationDTO {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(60)
  code: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  @IsOptional()
  country?: string;

  @IsBoolean()
  @IsOptional()
  active?: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  @IsOptional()
  displayOrder?: number;

  @IsString()
  @MaxLength(160)
  @IsOptional()
  inspectionAddress?: string;

  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsUrl()
  @IsOptional()
  inspectionMapUrl?: string;
}

export class UpdateServiceLocationDTO {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  @IsOptional()
  name?: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  @IsOptional()
  country?: string;

  @IsBoolean()
  @IsOptional()
  active?: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  @IsOptional()
  displayOrder?: number;

  @IsString()
  @MaxLength(160)
  @IsOptional()
  inspectionAddress?: string;

  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsUrl()
  @IsOptional()
  inspectionMapUrl?: string;
}

export class SetServiceLocationStatusDTO {
  @IsBoolean()
  active: boolean;
}
