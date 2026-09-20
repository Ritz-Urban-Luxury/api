import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isMongoId } from 'class-validator';
import { getPlayReviewAccount } from '../authentication/play-review-accounts';
import { DatabaseService } from '../database/database.service';
import { CardDocument } from '../database/schemas/card.schema';
import { PaymentMethod } from '../database/schemas/trips.schema';
import { UserDocument } from '../database/schemas/user.schema';
import { Util } from '../shared/util';
import { RequestReferenceDTO } from './dto/payment.dto';
import { PaymentProvider } from './types';
import { WalletTransactionType } from '../database/schemas/wallet-transaction.schema';

@Injectable()
export class PaymentService {
  private readonly providers: Record<string, PaymentProvider> = {};

  constructor(private readonly db: DatabaseService) {}

  private rejectPlayReviewerPayment(user: UserDocument) {
    if (getPlayReviewAccount(user.email)) {
      throw new BadRequestException(
        'Payments are disabled for Play reviewer accounts',
      );
    }
  }

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
      {
        $set: { deleted: false },
        $setOnInsert: {
          user: user.id,
          amount: 0,
          cashAmount: 0,
          rideCreditAmount: 0,
          reservedAmount: 0,
        },
      },
      { new: true, upsert: true },
    );
  }

  async generateReference(user: UserDocument, payload: RequestReferenceDTO) {
    this.rejectPlayReviewerPayment(user);
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
    this.rejectPlayReviewerPayment(user);
    const balance = await this.getUserBalance(user);
    if ((balance?.amount || 0) < Math.abs(amount)) {
      throw new BadRequestException('insufficient funds in RUL balance');
    }

    const debit = Math.abs(amount);
    const rideCreditAmount = Math.max(0, Number(balance.rideCreditAmount || 0));
    const legacyCashAmount = Math.max(
      0,
      Number(balance.amount || 0) -
        rideCreditAmount -
        Number(balance.reservedAmount || 0),
    );
    const cashAmount = Math.max(
      0,
      balance.cashAmount === undefined
        ? legacyCashAmount
        : Number(balance.cashAmount || 0),
    );
    const rideCreditDebit = Math.min(rideCreditAmount, debit);
    const cashDebit = debit - rideCreditDebit;
    const updated = await this.db.balances.findOneAndUpdate(
      { _id: balance?.id },
      {
        $set: {
          amount: Math.max(0, Number(balance.amount || 0) - debit),
          rideCreditAmount: rideCreditAmount - rideCreditDebit,
          cashAmount: Math.max(0, cashAmount - cashDebit),
        },
      },
      { new: true },
    );
    await this.db.walletTransactions.create({
      user: user.id,
      type: WalletTransactionType.Debit,
      amountKobo: -Math.round(debit * 100),
      purpose: 'wallet-payment',
      meta: {
        rideCreditKobo: Math.round(rideCreditDebit * 100),
        cashKobo: Math.round(cashDebit * 100),
      },
    });
    return updated;
  }

  async creditUserRULBalance(
    user: UserDocument,
    amount: number,
    kind: 'cash' | 'ride-credit' = 'cash',
    purpose = 'wallet-credit',
  ) {
    const balance = await this.getUserBalance(user);
    const credit = Math.abs(amount);

    const updated = await this.db.balances.findOneAndUpdate(
      { _id: balance?.id },
      {
        $inc: {
          amount: credit,
          ...(kind === 'ride-credit'
            ? { rideCreditAmount: credit }
            : { cashAmount: credit }),
        },
      },
      { new: true },
    );
    await this.db.walletTransactions.create({
      user: user.id,
      type:
        kind === 'ride-credit'
          ? WalletTransactionType.RideCredit
          : WalletTransactionType.CashCredit,
      amountKobo: Math.round(credit * 100),
      purpose,
    });
    return updated;
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
    this.rejectPlayReviewerPayment(user);
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
    this.rejectPlayReviewerPayment(user);
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
