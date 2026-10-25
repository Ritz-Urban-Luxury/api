import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class PermanentlyDeleteUserDTO {
  @IsString()
  @IsNotEmpty()
  confirmation: string;

  @IsString()
  @MinLength(8)
  @MaxLength(500)
  reason: string;
}
