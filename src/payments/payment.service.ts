import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { CardDocument } from 'src/database/schemas/card.schema';
import { PaymentMethod } from 'src/database/schemas/trips.schema';
import { UserDocument } from 'src/database/schemas/user.schema';
import { Util } from 'src/shared/util';
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
      throw new Error('insufficient funds in RUL balance');
    }

    return this.db.balances.findOneAndUpdate(
      { _id: balance?.id },
      { $inc: { amount: -amount } },
      { new: true },
    );
  }

  async debitUserCard(user: UserDocument, amount: number) {
    const card = await this.db.findOrFail<CardDocument>(
      this.db.cards,
      {
        user: user.id,
        isDefault: true,
        deleted: { $ne: true },
      },
      { error: new Error('No default card setup for user') },
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
      case PaymentMethod.Card:
        return this.debitUserCard(user, amount);
      case PaymentMethod.Cash:
        return 'Give the driver cash';
      default:
        throw new Error(`Cannot charge ${method} payment method`);
    }
  }
}
