import { Allow, IsOptional } from 'class-validator';

export class RequestReferenceDTO {
  @Allow()
  @IsOptional()
  meta?: unknown;
}
