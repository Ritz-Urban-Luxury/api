import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserDocument } from 'src/database/schemas/user.schema';

@Injectable()
export class VerifiedDriverGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const user = request.user as UserDocument;

    return !!user.isVerified;
  }
}
