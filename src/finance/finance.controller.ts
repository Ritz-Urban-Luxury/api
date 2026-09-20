import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../authentication/guards/jwt.guard';
import { UserDocument } from '../database/schemas/user.schema';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { Response } from '../shared/response';
import {
  CreateDriverDebtPaymentDTO,
  CreateDriverPayoutDTO,
  ResolveBankAccountDTO,
} from './dto/finance.dto';
import { FinanceService } from './finance.service';

@Controller('finance')
@UseGuards(JwtGuard)
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get('bank-accounts')
  async getBankAccounts(@CurrentUser() user: UserDocument) {
    return Response.json('bank accounts', await this.finance.listBankAccounts(user));
  }

  @Post('bank-accounts/resolve')
  async resolveBankAccount(
    @CurrentUser() user: UserDocument,
    @Body() payload: ResolveBankAccountDTO,
  ) {
    return Response.json(
      'bank account resolved',
      await this.finance.resolveAndSaveBankAccount(user, payload),
    );
  }

  @Get('account-closure')
  async getAccountClosure(@CurrentUser() user: UserDocument) {
    return Response.json(
      'account closure assessment',
      await this.finance.getAccountClosureAssessment(user),
    );
  }

  @Get('driver/position')
  async getDriverPosition(@CurrentUser() user: UserDocument) {
    return Response.json(
      'driver financial position',
      await this.finance.getDriverFinancialPosition(user),
    );
  }

  @Post('driver/payouts')
  async requestDriverPayout(
    @CurrentUser() user: UserDocument,
    @Body() payload: CreateDriverPayoutDTO,
  ) {
    return Response.json(
      'payout requested',
      await this.finance.createDriverPayout(user, payload),
    );
  }

  @Post('driver/debt-payment-reference')
  async createDebtPaymentReference(
    @CurrentUser() user: UserDocument,
    @Body() payload: CreateDriverDebtPaymentDTO,
  ) {
    return Response.json(
      'driver debt payment reference',
      await this.finance.createDriverDebtPaymentReference(user, payload.amount),
    );
  }
}
