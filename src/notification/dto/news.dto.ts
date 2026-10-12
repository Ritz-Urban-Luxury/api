import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Min,
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
  @Min(1)
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

  @IsObject()
  @IsOptional()
  bodyJson?: Record<string, unknown>;

  @IsString()
  @MaxLength(100000)
  @IsOptional()
  bodyHtml?: string;

  @IsInt()
  @MinLength(1)
  @IsOptional()
  contentVersion?: number;

  @IsEnum(NewsAudience)
  audience: NewsAudience;

  @IsEnum(NewsStatus)
  status: NewsStatus;

  @IsOptional()
  @IsDateString()
  publishedAt?: string;

  @Transform(trim)
  @IsString()
  @Matches(/^(https?:\/\/.+|asset:\/\/ritz-driver-welcome)$/, {
    message: 'coverImageUrl must be a valid http(s) image URL',
  })
  @MaxLength(500)
  coverImageUrl: string;
}

export class UpdateNewsDTO extends CreateNewsDTO {}
