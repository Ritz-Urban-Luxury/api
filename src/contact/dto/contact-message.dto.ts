import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const trimLower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export enum ContactTopic {
  General = 'general',
  Rider = 'rider',
  Driver = 'driver',
  Fleet = 'fleet',
}

export class ContactMessageDTO {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @Transform(trimLower)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsEnum(ContactTopic)
  topic: ContactTopic;

  @Transform(trim)
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  message: string;

  /** Honeypot. Hidden from people, so only bots fill it in. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}
