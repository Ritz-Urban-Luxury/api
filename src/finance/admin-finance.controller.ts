import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AdminJwtGuard } from '../authentication/guards/jwt.guard';
import { PayoutRequestStatus } from '../database/schemas/payout-request.schema';
import { UserDocument } from '../database/schemas/user.schema';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { Response } from '../shared/response';
import { ReviewPayoutDTO, UpdateFinancialSettingsDTO } from './dto/finance.dto';
import { FinanceService } from './finance.service';

@Controller('admin/finance')
@UseGuards(AdminJwtGuard)
export class AdminFinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get('requests')
  async listRequests(@Query('status') status?: PayoutRequestStatus) {
    return Response.json('financial requests', await this.finance.listPayoutRequests(status));
  }

  @Post('requests/:requestId/approve')
  async approve(
    @CurrentUser() admin: UserDocument,
    @Param('requestId') requestId: string,
  ) {
    return Response.json('financial request approved', await this.finance.approvePayout(admin, requestId));
  }

  @Post('requests/:requestId/reject')
  async reject(
    @CurrentUser() admin: UserDocument,
    @Param('requestId') requestId: string,
    @Body() payload: ReviewPayoutDTO,
  ) {
    return Response.json(
      'financial request rejected',
      await this.finance.rejectPayout(admin, requestId, payload.reason),
    );
  }

  @Get('settings')
  async getSettings() {
    return Response.json('financial settings', await this.finance.getSettings());
  }

  @Patch('settings')
  async updateSettings(
    @CurrentUser() admin: UserDocument,
    @Body() payload: UpdateFinancialSettingsDTO,
  ) {
    return Response.json(
      'financial settings updated',
      await this.finance.updateSettings(admin, payload),
    );
  }
}
