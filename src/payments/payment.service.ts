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
    if ((balance?.amount || 0) < amount) {
      throw new BadRequestException('insufficient funds in RUL balance');
    }

    return this.db.balances.findOneAndUpdate(
      { _id: balance?.id },
      { $set: { amount: balance.amount - Math.abs(amount) } },
      { new: true },
    );
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
        isDefault: true,
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
    payload: { amount: number; method: PaymentMethod },
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
