import {
  BadGatewayException,
  BadRequestException,
  CACHE_MANAGER,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Cache } from 'cache-manager';
import * as Crypto from 'crypto';
import { DatabaseService } from '../../../database/database.service';
import { CardDocument } from '../../../database/schemas/card.schema';
import { UserDocument } from '../../../database/schemas/user.schema';
import { Logger } from '../../../logger/logger.service';
import { PaymentService } from '../../payment.service';
import { PaymentProvider } from '../../types';
import { NotificationService } from '../../../notification';
import config from '../../../shared/config';
import { Http } from '../../../shared/http';
import { Util } from '../../../shared/util';
import {
  ChargeSuccessData,
  CustomerIdentificationSuccessData,
  ListBanksResponse,
  NigerianBank,
  ResolveAccountResponse,
  TransferRecipientResponse,
  InitiateTransferResponse,
  InitializeTransactionResponse,
  TransferFailureData,
  TransferSuccessData,
  WebhookPayload,
} from './types';

@Injectable()
export class PaystackService implements PaymentProvider {
  private readonly name = 'Paystack';

  private readonly nigerianBanksCacheKey = 'paystack:nigerian-banks';

  private readonly nigerianBanksCacheTtl = 24 * 60 * 60 * 1000;

  private readonly client: Http;

  private readonly webhookHandlers: Record<
    string,
    (payload: WebhookPayload, logger: Logger) => unknown
  >;

  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly logger: Logger,
    private readonly db: DatabaseService,
    private readonly paymentService: PaymentService,
    private readonly notifications: NotificationService,
  ) {
    const { paystack } = config();
    const baseURL = (paystack.url || '').trim() || 'https://api.paystack.co';

    this.client = new Http({
      baseURL,
      headers: { Authorization: `Bearer ${paystack.secretKey || ''}` },
    });

    this.webhookHandlers = {
      'charge.success': this.handleChargeSuccessEvent,
      'transfer.success': this.handleTransferSuccessEvent,
      'transfer.failed': this.handleTransferFailedEvent,
      'transfer.reversed': this.handleTransferReversedEvent,
      'refund.pending': this.handleRefundEvent,
      'refund.processing': this.handleRefundEvent,
      'refund.needs-attention': this.handleRefundEvent,
      'refund.failed': this.handleRefundEvent,
      'refund.processed': this.handleRefundEvent,
    };

    this.paymentService.registerPaymentProvider(this.name, this);
  }

  async getNigerianBanks(): Promise<NigerianBank[]> {
    try {
      const cachedBanks = await this.cache.get<NigerianBank[]>(
        this.nigerianBanksCacheKey,
      );
      if (cachedBanks?.length) {
        return cachedBanks;
      }
    } catch (error) {
      this.logger.warn('Unable to read Nigerian banks from cache', error);
    }

    if (!config().paystack.secretKey?.trim()) {
      throw new ServiceUnavailableException(
        'Paystack is not configured (missing PAYSTACK_SECRET_KEY)',
      );
    }

    try {
      const banksByCode = new Map<string, NigerianBank>();
      const seenCursors = new Set<string>();
      let nextCursor: string | null | undefined;

      do {
        const response = await this.client.get<ListBanksResponse>('/bank', {
          params: {
            country: 'nigeria',
            currency: 'NGN',
            perPage: 100,
            type: 'nuban',
            use_cursor: true,
            ...(nextCursor ? { next: nextCursor } : {}),
          },
        });

        if (!response.status || !Array.isArray(response.data)) {
          throw new Error('Paystack returned an invalid bank list');
        }

        response.data
          .filter((bank) => bank.active && !bank.is_deleted)
          .forEach((bank) => {
            banksByCode.set(bank.code, {
              code: bank.code,
              name: bank.name,
              slug: bank.slug,
              type: bank.type,
            });
          });

        nextCursor = response.meta?.next;
        if (nextCursor && seenCursors.has(nextCursor)) {
          break;
        }
        if (nextCursor) {
          seenCursors.add(nextCursor);
        }
      } while (nextCursor);

      const banks = Array.from(banksByCode.values()).sort((first, second) =>
        first.name.localeCompare(second.name),
      );

      try {
        await this.cache.set(
          this.nigerianBanksCacheKey,
          banks,
          this.nigerianBanksCacheTtl,
        );
      } catch (error) {
        this.logger.warn('Unable to cache Nigerian banks', error);
      }

      return banks;
    } catch (error) {
      this.logger.error('Unable to retrieve Nigerian banks from Paystack', {
        error,
      });
      throw new BadGatewayException('Unable to retrieve Nigerian banks');
    }
  }

  async resolveBankAccount(accountNumber: string, bankCode: string) {
    try {
      const response = await this.client.get<ResolveAccountResponse>(
        '/bank/resolve',
        {
          params: {
            account_number: accountNumber,
            bank_code: bankCode,
          },
        },
      );
      if (!response.status || !response.data?.account_name) {
        throw new Error(response.message || 'Unable to resolve bank account');
      }
      return response.data;
    } catch (error) {
      throw new BadRequestException(
        (error as Error)?.message || 'Unable to resolve bank account',
      );
    }
  }

  async initializeTransaction(payload: {
    email: string;
    amountKobo: number;
    reference: string;
    metadata?: Record<string, unknown>;
  }) {
    try {
      const response = await this.client.post<InitializeTransactionResponse>(
        '/transaction/initialize',
        {
          email: payload.email,
          amount: payload.amountKobo,
          currency: 'NGN',
          reference: payload.reference,
          metadata: payload.metadata,
        },
      );
      if (!response.status || !response.data?.authorization_url) {
        throw new Error(response.message || 'Unable to initialize payment');
      }
      return response.data;
    } catch (error) {
      throw new BadGatewayException(
        (error as Error)?.message || 'Unable to initialize payment',
      );
    }
  }

  async createTransferRecipient(payload: {
    accountName: string;
    accountNumber: string;
    bankCode: string;
  }) {
    try {
      const response = await this.client.post<TransferRecipientResponse>(
        '/transferrecipient',
        {
          type: 'nuban',
          name: payload.accountName,
          account_number: payload.accountNumber,
          bank_code: payload.bankCode,
          currency: 'NGN',
        },
      );
      if (!response.status || !response.data?.recipient_code) {
        throw new Error(response.message || 'Unable to create transfer recipient');
      }
      return response.data;
    } catch (error) {
      throw new BadRequestException(
        (error as Error)?.message || 'Unable to create transfer recipient',
      );
    }
  }

  async initiateTransfer(payload: {
    amountKobo: number;
    recipientCode: string;
    reason: string;
    reference: string;
  }) {
    try {
      const response = await this.client.post<InitiateTransferResponse>(
        '/transfer',
        {
          source: 'balance',
          amount: Math.round(payload.amountKobo),
          recipient: payload.recipientCode,
          reason: payload.reason,
          reference: payload.reference,
        },
      );
      if (!response.status || !response.data?.reference) {
        throw new Error(response.message || 'Unable to initiate transfer');
      }
      return response.data;
    } catch (error) {
      throw new BadRequestException(
        (error as Error)?.message || 'Unable to initiate transfer',
      );
    }
  }

  async chargeCard(payload: {
    user: UserDocument;
    card: CardDocument;
    amount: number;
    reference?: string;
  }) {
    try {
      const { paystack } = config();
      if (!paystack.secretKey?.trim()) {
        throw new Error(
          'Paystack is not configured (missing PAYSTACK_SECRET_KEY)',
        );
      }

      const { card, amount, user } = payload;
      const authorization =
        typeof card.meta?.authorization === 'string'
          ? card.meta.authorization
          : '';
      if (!authorization) {
        throw new Error('Saved card is missing a Paystack authorization code');
      }

      const reference =
        payload.reference?.trim() ||
        `rul_${user.id}_${Date.now().toString(36)}`;

      const res = await this.client.post('/transaction/charge_authorization', {
        email: card.email || user.email,
        amount: Math.round(amount * 100),
        reference,
        authorization_code: authorization,
      });
      const data = (res as Record<string, unknown>).data as Record<
        string,
        unknown
      >;

      if (
        !['Approved', 'success', 'approved'].includes(data.status as string)
      ) {
        throw new Error(
          (data.gateway_response as string) || 'Card charge was declined',
        );
      }

      return data;
    } catch (error) {
      throw new BadRequestException(
        (error as Error)?.message || 'Unable to charge card',
      );
    }
  }

  async refund(payload: {
    transaction: string | number;
    amount?: number;
    currency?: string;
    customer_note?: string;
    merchant_note?: string;
  }) {
    try {
      const body: Record<string, unknown> = {
        transaction: payload.transaction,
      };

      if (typeof payload.amount === 'number') {
        body.amount = Math.round(payload.amount * 100);
      }
      if (payload.currency) {
        body.currency = payload.currency;
      }
      if (payload.customer_note) {
        body.customer_note = payload.customer_note;
      }
      if (payload.merchant_note) {
        body.merchant_note = payload.merchant_note;
      }

      const res = await this.client.post('/refund', body);
      return (res as Record<string, unknown>).data;
    } catch (error) {
      throw new BadRequestException(
        error?.message || 'Unable to process Paystack refund',
      );
    }
  }

  async handleWebhook(payload: unknown, paystackSignature: string) {
    const logger = this.logger.child({
      trackingId: Math.random().toString(32).substring(2),
    });

    logger.log('paystack webhook', payload);

    if (this.isWebhookPayload(payload)) {
      const hash = Crypto.createHmac('sha512', config().paystack.secretKey)
        .update(JSON.stringify(payload))
        .digest('hex');
      if (hash === paystackSignature) {
        logger.log('hook matches');
        const handler = this.webhookHandlers[payload.event];
        if (handler) {
          logger.log('handler found for hook');
          return handler.bind(this)(payload, logger);
        }

        logger.log('handler not found for hook');
      }
    }

    return null;
  }

  isWebhookPayload(payload: unknown): payload is WebhookPayload {
    return Util.isPriObj(payload) && !!payload.event && !!payload.data;
  }

  isChargeSuccessData(payload: unknown): payload is ChargeSuccessData {
    return (
      Util.isPriObj(payload) &&
      !!payload.amount &&
      !!payload.channel &&
      !!payload.reference
    );
  }

  isTransferSuccessData(payload: unknown): payload is TransferSuccessData {
    return Util.isPriObj(payload) && !!payload.reference && !!payload.amount;
  }

  isCustomerIdentificationSuccessData(
    payload: unknown,
  ): payload is CustomerIdentificationSuccessData {
    return (
      Util.isPriObj(payload) && !!payload.customer_code && !!payload.customer_id
    );
  }

  isTransferFailureData(payload: unknown): payload is TransferFailureData {
    return Util.isPriObj(payload) && !!payload.reference && !!payload.amount;
  }

  async handleChargeSuccessEvent(payload: WebhookPayload, logger: Logger) {
    try {
      const { data } = payload;
      if (this.isChargeSuccessData(data)) {
        logger.log('charge success event');
        const { reference, channel, customer, authorization } = data;
        const amount = data.amount / 100;

        if (channel === 'dedicated_nuban') {
          const user = await this.db.users
            .findOne({ email: customer.email })
            .select('_id');
          if (!user) {
            return;
          }

          await this.db.authTokens.findOneAndUpdate(
            {
              token: reference,
            },
            {
              $set: {
                token: reference,
                meta: { type: 'payment-reference', user: user.id },
              },
            },
            { upsert: true },
          );
        }

        const { meta } = await this.db.markTokenAsUsedOrFail(
          {
            'meta.type': 'payment-reference',
            token: reference,
            deleted: { $ne: true },
            isUsed: { $ne: true },
          },
          new BadRequestException(
            'used reference or unknown charge success event',
          ),
        );

        if (meta.purpose === 'driver-debt-payment') {
          const expectedAmount = Number(meta.amount || 0);
          if (!Number.isFinite(expectedAmount) || expectedAmount !== amount) {
            throw new BadRequestException('Driver debt payment amount mismatch');
          }
          await this.applyDriverDebtPayment(String(meta.user), amount, reference);
          return;
        }

        const [user] = await Promise.all([
          this.db.users.findById(meta.user),
          this.db.balances.findOneAndUpdate(
            {
              user: meta.user,
              deleted: { $ne: true },
            },
            {
              $inc: { amount, cashAmount: amount },
              $setOnInsert: { rideCreditAmount: 0, reservedAmount: 0 },
            },
            { upsert: true, new: true },
          ),
          this.db.walletTransactions.create({
            user: meta.user,
            type: 'CashCredit',
            amountKobo: Math.round(amount * 100),
            purpose: 'wallet-top-up',
            provider: this.name,
            providerReference: reference,
          }),
        ]);

        if (channel === 'card') {
          const query = {
            user: user.id,
            expiryMonth: authorization.exp_month,
            expiryYear: authorization.exp_year,
            lastFour: authorization.last4,
            provider: this.name,
          };

          const card = await this.db.cards.findOneAndUpdate(
            query,
            {
              ...query,
              email: customer.email,
              name: `${user.firstName} ${user.lastName}`,
              brand: authorization.brand,
              isDefault: true,
              meta: {
                authorization: authorization.authorization_code,
                signature: authorization.signature,
                authData: authorization,
              },
            },
            { upsert: true, new: true },
          );

          await this.db.cards.updateMany(
            { user: user.id, _id: { $ne: card.id } },
            { $set: { isDefault: false } },
          );
        }
      }
    } catch (error) {
      logger.error(`error handling charge success - ${error.message}`, {
        payload,
      });
      throw error;
    }
  }

  private async applyDriverDebtPayment(
    driverId: string,
    amountNaira: number,
    reference: string,
  ) {
    const amountKobo = Math.round(amountNaira * 100);
    await this.db.driverLedgerEntries.create({
      driver: driverId,
      type: 'Adjustment',
      amount: -amountNaira,
      earnedAt: new Date(),
      purpose: 'driver-debt-payment',
      reference,
    });

    const state = await this.db.driverFinancialStates.findOne({
      driver: driverId,
    });
    if (!state?.restricted) {
      return;
    }
    const paidTowardRestrictionKobo =
      (state.paidTowardRestrictionKobo || 0) + amountKobo;
    await this.db.driverFinancialStates.updateOne(
      { _id: state.id },
      paidTowardRestrictionKobo >= state.requiredDepositKobo
        ? {
            $set: {
              restricted: false,
              paidTowardRestrictionKobo,
              releasedAt: new Date(),
            },
          }
        : { $set: { paidTowardRestrictionKobo } },
    );
  }

  private async handleTransferSuccessEvent(payload: WebhookPayload) {
    const data = payload.data as Record<string, unknown>;
    const reference = String(data.reference || '');
    if (!reference) return;
    const request = await this.db.payoutRequests.findOneAndUpdate(
      { providerReference: reference, status: { $ne: 'Paid' } },
      {
        $set: {
          status: 'Paid',
          paidAt: new Date(),
          providerMeta: data,
        },
      },
      { new: true },
    );
    if (request) await this.finalizePaidRequest(request);
    if (request) this.notifyPayoutStatus(request, 'Your Ritz payout is complete');
  }

  private async handleTransferFailedEvent(payload: WebhookPayload) {
    const data = payload.data as Record<string, unknown>;
    const reference = String(data.reference || '');
    if (!reference) return;
    const request = await this.db.payoutRequests.findOneAndUpdate(
      { providerReference: reference, status: { $ne: 'Paid' } },
      {
        $set: {
          status: 'FailedRetryable',
          failureReason: String(data.reason || 'Transfer failed'),
          providerMeta: data,
        },
      },
      { new: true },
    );
    if (request) this.notifyPayoutStatus(request, 'Your Ritz payout needs attention');
  }

  private async handleTransferReversedEvent(payload: WebhookPayload) {
    const data = payload.data as Record<string, unknown>;
    const reference = String(data.reference || '');
    if (!reference) return;
    const request = await this.db.payoutRequests.findOneAndUpdate(
      { providerReference: reference },
      {
        $set: {
          status: 'Reversed',
          failureReason: String(data.reason || 'Transfer reversed'),
          providerMeta: data,
        },
      },
      { new: true },
    );
    if (request) this.notifyPayoutStatus(request, 'Your Ritz payout was reversed');
  }

  private async handleRefundEvent(payload: WebhookPayload) {
    const data = payload.data as Record<string, unknown>;
    const transactionReference = String(data.transaction_reference || '');
    if (!transactionReference) return;
    const statusByEvent: Record<string, string> = {
      'refund.pending': 'Processing',
      'refund.processing': 'Processing',
      'refund.needs-attention': 'ActionRequired',
      'refund.failed': 'FailedRetryable',
      'refund.processed': 'Paid',
    };
    const status = statusByEvent[payload.event];
    const request = await this.db.payoutRequests.findOneAndUpdate(
      { providerTransactionReference: transactionReference, status: { $ne: status } },
      {
        $set: {
          status,
          ...(status === 'Paid' ? { paidAt: new Date() } : {}),
          providerMeta: data,
        },
      },
      { new: true },
    );
    if (status === 'Paid' && request) await this.finalizePaidRequest(request);
    if (request && status === 'Paid') {
      this.notifyPayoutStatus(request, 'Your Ritz refund is complete');
    } else if (request && ['ActionRequired', 'FailedRetryable'].includes(status)) {
      this.notifyPayoutStatus(request, 'Your Ritz refund needs attention');
    }
  }

  private notifyPayoutStatus(
    request: {
      notificationEmail?: string;
      notificationPhone?: string;
      publicReference?: string;
    },
    subject: string,
  ) {
    const reference = request.publicReference || 'Unavailable';
    if (request.notificationEmail) {
      void this.notifications
        .sendEmail({
          recipient: request.notificationEmail,
          subject,
          template: 'financial-status.template.njk',
          context: { firstName: 'there', subject, reference },
        })
        ?.catch(() => undefined);
    }
    if (request.notificationPhone) {
      void Promise.resolve(
        this.notifications.sendSMS({
          to: request.notificationPhone,
          sms: `${subject}. Reference: ${reference}.`,
        }),
      ).catch(() => undefined);
    }
  }

  private async finalizePaidRequest(request: {
    id?: string;
    user: unknown;
    type: string;
    amountKobo: number;
    debtOffsetKobo?: number;
    providerReference: string;
  }) {
    const userId = String(
      (request.user as { id?: string; _id?: string })?.id ||
        (request.user as { _id?: string })?._id ||
        request.user,
    );
    if (request.type === 'RiderAccountClosure') {
      await Promise.all([
        this.db.balances.updateOne(
          { user: userId },
          { $set: { reservedAmount: 0 } },
        ),
        this.db.walletTransactions.updateOne(
          {
            providerReference: request.providerReference,
            type: 'WithdrawalPaid',
          },
          {
            $setOnInsert: {
              user: userId,
              type: 'WithdrawalPaid',
              amountKobo: -Math.abs(request.amountKobo),
              purpose: 'account-closure',
              provider: this.name,
              providerReference: request.providerReference,
            },
          },
          { upsert: true },
        ),
      ]);
      return;
    }

    const debtOffsetKobo = Math.max(0, Number(request.debtOffsetKobo || 0));
    if (debtOffsetKobo > 0) {
      await this.db.driverLedgerEntries.updateOne(
        { reference: `net_${request.providerReference}` },
        {
          $setOnInsert: {
            driver: userId,
            type: 'Adjustment',
            amount: -(debtOffsetKobo / 100),
            earnedAt: new Date(),
            purpose: 'driver-payout-netting',
            reference: `net_${request.providerReference}`,
          },
        },
        { upsert: true },
      );
    }
  }
}
