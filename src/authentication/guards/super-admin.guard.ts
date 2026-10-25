import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AdminRole, UserDocument } from '../../database/schemas/user.schema';

@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: UserDocument }>();
    return request.user?.adminRole === AdminRole.SuperAdmin;
  }
}
