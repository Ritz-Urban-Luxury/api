import { IsNotEmpty, IsString } from 'class-validator';

export class FileUploadDTO {
  @IsString()
  @IsNotEmpty()
  filename: string;

  @IsString()
  @IsNotEmpty()
  data: string;
}
