import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminUserController } from './admin-users.controller';
import { DashboardService } from './dashboard.service';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { FinanceModule } from '../finance/finance.module';

@Module({
  imports: [NotificationModule, FinanceModule],
  controllers: [UserController, AdminUserController, AdminDashboardController],
  providers: [UserService, DashboardService],
  exports: [UserService],
})
export class UserModule {}
