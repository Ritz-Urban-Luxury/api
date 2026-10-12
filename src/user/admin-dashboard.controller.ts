import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminJwtGuard } from 'src/authentication/guards/jwt.guard';
import { Response } from 'src/shared/response';
import { DashboardService } from './dashboard.service';

@Controller('admin/dashboard')
@UseGuards(AdminJwtGuard)
export class AdminDashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  async getDashboard() {
    const data = await this.dashboardService.getDashboard();

    return Response.json('dashboard', data);
  }

  /** Light endpoint for the admin sidebar badges, polled in the background. */
  @Get('attention')
  async getAttention() {
    return Response.json(
      'dashboard attention',
      await this.dashboardService.getAttention(),
    );
  }
}
