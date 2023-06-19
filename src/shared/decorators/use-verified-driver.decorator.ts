import { UseGuards, applyDecorators } from '@nestjs/common';
import { JwtGuard } from 'src/authentication/guards/jwt.guard';
import { VerifiedDriverGuard } from '../guards/verified-driver.guard';

export const UseVerifiedDriver = () =>
  applyDecorators(UseGuards(JwtGuard), UseGuards(VerifiedDriverGuard));
