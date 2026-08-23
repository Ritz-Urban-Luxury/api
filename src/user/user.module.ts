import { Module } from '@nestjs/common';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminUserController } from './admin-users.controller';
import { DashboardService } from './dashboard.service';
import { UserController } from './user.controller';
import { UserService } from './user.service';

@Module({
  controllers: [UserController, AdminUserController, AdminDashboardController],
  providers: [UserService, DashboardService],
  exports: [UserService],
})
export class UserModule {}
