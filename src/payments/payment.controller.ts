import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../authentication/guards/jwt.guard';
import { UserDocument } from '../database/schemas/user.schema';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { Response } from '../shared/response';
import { RequestReferenceDTO } from './dto/payment.dto';
import { PaymentService } from './payment.service';
import { MonnifyService } from './providers/monnify/monify.service';
import { PaystackService } from './providers/paystack/paystack.service';

@Controller('payments')
export class PaymentController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly monnifyService: MonnifyService,
    private readonly paystackService: PaystackService,
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

  @Post('webhooks/paystack')
  @HttpCode(HttpStatus.OK)
  async paystackWebhook(
    @Body() payload: unknown,
    @Headers() headers: Record<string, string>,
  ) {
    await this.paystackService.handleWebhook(
      payload,
      headers['x-paystack-signature'],
    );

    return Response.json('thanks boo');
  }

  @UseGuards(JwtGuard)
  @Get('cards')
  async getCards(@CurrentUser() user: UserDocument) {
    const cards = await this.paymentService.getCards(user);

    return Response.json('cards', cards);
  }

  @UseGuards(JwtGuard)
  @Delete('cards/:id')
  async deleteCard(@CurrentUser() user: UserDocument, @Param('id') id: string) {
    const charge = await this.paymentService.deleteCard(user, id);

    return Response.json('charge deleted', charge);
  }
}
