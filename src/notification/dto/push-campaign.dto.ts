import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PushCampaignAudience } from '../../database/schemas/push-campaign.schema';

const normalizeOptionalString = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

export class PushCampaignAudienceDTO {
  @IsEnum(PushCampaignAudience)
  audience: PushCampaignAudience;
}

export class CreatePushCampaignDTO extends PushCampaignAudienceDTO {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  title: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  body: string;

  @Transform(normalizeOptionalString)
  @IsOptional()
  @IsString()
  @Matches(/^\/(?!\/)/, { message: 'riderUrl must be a relative app route' })
  @MaxLength(200)
  riderUrl?: string;

  @Transform(normalizeOptionalString)
  @IsOptional()
  @IsString()
  @Matches(/^\/(?!\/)/, { message: 'driverUrl must be a relative app route' })
  @MaxLength(200)
  driverUrl?: string;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;
}

export class SendTestPushCampaignDTO extends CreatePushCampaignDTO {}
