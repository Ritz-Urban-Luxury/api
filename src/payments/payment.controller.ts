import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtGuard } from 'src/authentication/guards/jwt.guard';
import { CurrentUser } from 'src/shared/decorators/current-user.decorator';
import { Response } from 'src/shared/response';
import { UserDocument } from 'src/user';
import { PaymentService } from './payment.service';

@Controller('payments')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @UseGuards(JwtGuard)
  @Get('balances')
  async getUserBalance(@CurrentUser() user: UserDocument) {
    const balance = await this.paymentService.getUserBalance(user);

    return Response.json('rul balance', balance);
  }
}
