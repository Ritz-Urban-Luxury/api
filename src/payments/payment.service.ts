import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isMongoId } from 'class-validator';
import { DatabaseService } from '../database/database.service';
import { CardDocument } from '../database/schemas/card.schema';
import { PaymentMethod } from '../database/schemas/trips.schema';
import { UserDocument } from '../database/schemas/user.schema';
import { Util } from '../shared/util';
import { RequestReferenceDTO } from './dto/payment.dto';
import { PaymentProvider } from './types';

@Injectable()
export class PaymentService {
  private readonly providers: Record<string, PaymentProvider> = {};

  constructor(private readonly db: DatabaseService) {}

  registerPaymentProvider(name: string, service: PaymentProvider) {
    this.providers[name] = service;
  }

  getPaymentProvider(name: string) {
    const service = this.providers[name];
    if (!service) {
      throw new Error(`No payment provider registered for ${name}`);
    }

    return service;
  }

  async getUserBalance(user: UserDocument) {
    return this.db.balances.findOneAndUpdate(
      { user: user.id },
      { user: user.id, deleted: false },
      { new: true, upsert: true },
    );
  }

  async generateReference(user: UserDocument, payload: RequestReferenceDTO) {
    let meta = { type: 'payment-reference', user: user.id };
    if (Util.isPriObj(payload.meta)) {
      meta = { ...payload.meta, ...meta };
    }

    const token = Math.random().toString(32).substring(2);

    await this.db.authTokens.create({
      token,
      meta,
    });

    return token;
  }

  async debitUserRULBalance(user: UserDocument, amount: number) {
    const balance = await this.getUserBalance(user);
    if ((balance?.amount || 0) < Math.abs(amount)) {
      throw new BadRequestException('insufficient funds in RUL balance');
    }

    return this.db.balances.findOneAndUpdate(
      { _id: balance?.id },
      { $set: { amount: balance.amount - Math.abs(amount) } },
      { new: true },
    );
  }

  async creditUserRULBalance(user: UserDocument, amount: number) {
    const balance = await this.getUserBalance(user);
    const credit = Math.abs(amount);

    return this.db.balances.findOneAndUpdate(
      { _id: balance?.id },
      { $inc: { amount: credit } },
      { new: true },
    );
  }

  extractChargeTransaction(paymentResponse: unknown): string | number | null {
    if (!paymentResponse || typeof paymentResponse !== 'object') {
      return null;
    }

    const data = paymentResponse as Record<string, unknown>;
    if (typeof data.reference === 'string' && data.reference.trim()) {
      return data.reference;
    }
    if (typeof data.id === 'number' || typeof data.id === 'string') {
      return data.id;
    }

    return null;
  }

  async refundCharge(payload: {
    user?: UserDocument | null;
    paymentMethod: PaymentMethod | string;
    paymentResponse: unknown;
    amount: number;
    note?: string;
  }) {
    const { user, paymentMethod, paymentResponse, amount, note } = payload;
    const refundAmount = Math.abs(amount);

    if (refundAmount <= 0) {
      throw new BadRequestException('Refund amount must be greater than zero');
    }

    if (paymentMethod === PaymentMethod.Cash) {
      return { provider: 'Cash', amount: refundAmount, status: 'noop' };
    }

    if (paymentMethod === PaymentMethod.RULBalance) {
      if (!user) {
        return {
          provider: PaymentMethod.RULBalance,
          amount: refundAmount,
          status: 'skipped',
          reason: 'rider account missing',
        };
      }

      const balance = await this.creditUserRULBalance(user, refundAmount);
      return {
        provider: PaymentMethod.RULBalance,
        amount: refundAmount,
        status: 'processed',
        balance,
      };
    }

    const transaction = this.extractChargeTransaction(paymentResponse);
    if (!transaction) {
      // Old/test bookings often have no usable charge payload.
      return {
        provider: 'Paystack',
        amount: refundAmount,
        status: 'skipped',
        reason: 'no charge reference found for card refund',
      };
    }

    const paystack = this.getPaymentProvider('Paystack');
    if (!paystack.refund) {
      throw new BadRequestException('Refunds are not supported for Paystack');
    }

    const refundResponse = await paystack.refund({
      transaction,
      amount: refundAmount,
      customer_note: note,
      merchant_note: note,
    });

    return {
      provider: 'Paystack',
      amount: refundAmount,
      status: 'queued',
      transaction,
      refundResponse,
    };
  }

  async debitUserCard(user: UserDocument, amount: number, cardId: string) {
    const error = new BadRequestException(
      `Cannot charge ${cardId} payment method`,
    );
    if (!isMongoId(cardId)) {
      throw error;
    }

    const card = await this.db.findOrFail<CardDocument>(
      this.db.cards,
      {
        _id: cardId,
        user: user.id,
        deleted: { $ne: true },
      },
      { error },
    );
    const paymentProvider = this.getPaymentProvider(card.provider);

    return paymentProvider.chargeCard.bind(paymentProvider)({
      card,
      user,
      amount,
    });
  }

  async chargeUser(
    user: UserDocument,
    payload: { amount: number; method: PaymentMethod | string },
  ) {
    const { amount, method } = payload;
    switch (method) {
      case PaymentMethod.RULBalance:
        return this.debitUserRULBalance(user, amount);
      case PaymentMethod.Cash:
        return 'Give the driver cash';
      default:
        return this.debitUserCard(user, amount, method as string);
    }
  }

  async getCards(user: UserDocument) {
    return this.db.cards.find({ user: user.id });
  }

  async deleteCard(user: UserDocument, cardId: string) {
    const card = await this.db.cards.findOneAndUpdate(
      {
        _id: cardId,
        user: user.id,
      },
      { $set: { deleted: true } },
      { new: true },
    );
    if (!card) {
      throw new NotFoundException('Card not found');
    }

    return card;
  }
}
