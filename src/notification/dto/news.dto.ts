import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  NewsAudience,
  NewsStatus,
} from '../../database/schemas/news-article.schema';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateNewsDTO {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  summary: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  body: string;

  @IsEnum(NewsAudience)
  audience: NewsAudience;

  @IsEnum(NewsStatus)
  status: NewsStatus;

  @IsOptional()
  @IsDateString()
  publishedAt?: string;

  @Transform(trim)
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  coverImageUrl?: string;
}

export class UpdateNewsDTO extends CreateNewsDTO {}
