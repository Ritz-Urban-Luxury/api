import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification';
import { AdminDashboardController } from './admin-dashboard.controller';
import { AdminUserController } from './admin-users.controller';
import { DashboardService } from './dashboard.service';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { FinanceModule } from '../finance/finance.module';
import { RidesModule } from '../rides/rides.module';
import { DriverOnboardingService } from './driver-onboarding.service';
import { TestAccountService } from './test-account.service';

@Module({
  imports: [NotificationModule, FinanceModule, RidesModule],
  controllers: [UserController, AdminUserController, AdminDashboardController],
  providers: [
    UserService,
    DashboardService,
    DriverOnboardingService,
    TestAccountService,
  ],
  exports: [UserService],
})
export class UserModule {}
