import { IsNumber, IsOptional } from 'class-validator';

export class PaginationRequestDTO {
  @IsNumber()
  @IsOptional()
  page?: number;

  @IsNumber()
  @IsOptional()
  limit?: number;
}
