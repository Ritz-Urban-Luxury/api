import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from 'src/authentication/guards/jwt.guard';
import { UserDocument } from 'src/database/schemas/user.schema';
import { CurrentUser } from 'src/shared/decorators/current-user.decorator';
import { Response } from 'src/shared/response';
import { RequestReferenceDTO } from './dto/payment.dto';
import { PaymentService } from './payment.service';
import { MonnifyService } from './providers/monnify/monify.service';

@Controller('payments')
export class PaymentController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly monnifyService: MonnifyService,
  ) {}

  @UseGuards(JwtGuard)
  @Get('balances')
  async getUserBalance(@CurrentUser() user: UserDocument) {
    const balance = await this.paymentService.getUserBalance(user);

    return Response.json('rul balance', balance);
  }

  @UseGuards(JwtGuard)
  @Post('references')
  async generateReference(
    @CurrentUser() user: UserDocument,
    @Body() payload: RequestReferenceDTO,
  ) {
    const reference = await this.paymentService.generateReference(
      user,
      payload,
    );

    return Response.json('reference generated', reference);
  }

  @Post('webhooks/monnify')
  @HttpCode(HttpStatus.OK)
  async monnifyWebhook(
    @Body() payload: unknown,
    @Headers() headers: Record<string, string>,
  ) {
    await this.monnifyService.handleWebhook(
      payload,
      headers['monnify-signature'],
    );

    return Response.json('thanks boo');
  }
}
