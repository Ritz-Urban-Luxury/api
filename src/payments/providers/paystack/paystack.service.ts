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
import config from '../../../shared/config';
import { Http } from '../../../shared/http';
import { Util } from '../../../shared/util';
import {
  ChargeSuccessData,
  CustomerIdentificationSuccessData,
  ListBanksResponse,
  NigerianBank,
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
  ) {
    const { paystack } = config();
    const baseURL = (paystack.url || '').trim() || 'https://api.paystack.co';

    this.client = new Http({
      baseURL,
      headers: { Authorization: `Bearer ${paystack.secretKey || ''}` },
    });

    this.webhookHandlers = {
      'charge.success': this.handleChargeSuccessEvent,
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

        const [user] = await Promise.all([
          this.db.users.findById(meta.user),
          this.db.balances.findOneAndUpdate(
            {
              user: meta.user,
              deleted: { $ne: true },
            },
            { $inc: { amount } },
            { upsert: true, new: true },
          ),
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
}
