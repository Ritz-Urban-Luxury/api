import { CACHE_MANAGER, Inject, Injectable } from '@nestjs/common';
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
import { WebhookPayload } from './types';

@Injectable()
export class MonnifyService implements PaymentProvider {
  private readonly name = 'Monnify';

  private readonly client: Http;

  private readonly webhookHandlers: Record<
    string,
    (payload: WebhookPayload) => unknown
  >;

  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly logger: Logger,
    private readonly db: DatabaseService,
    private readonly paymentService: PaymentService,
  ) {
    this.client = new Http({ baseURL: `${config().monnify.apiUrl}/api/v1` });

    this.webhookHandlers = {
      SUCCESSFUL_TRANSACTION: this.handleSuccessfulTransaction,
    };

    this.paymentService.registerPaymentProvider(this.name, this);
  }

  chargeCard(_payload: {
    user: UserDocument;
    card: CardDocument;
    amount: number;
  }): Promise<unknown> {
    throw new Error('Method not implemented.');
  }

  async getAccessToken() {
    const cacheKey = 'monnify_access_token';
    let token = await this.cache.get<string>(cacheKey);
    if (!token) {
      const resp = await this.client.post<{
        responseBody: { accessToken: string; expiresIn: number };
      }>('/auth/login', null, {
        auth: {
          username: config().monnify.apiKey,
          password: config().monnify.secret,
        },
      });

      token = resp.responseBody.accessToken;

      await this.cache.set(
        cacheKey,
        token,
        (resp.responseBody.expiresIn - 10) * 1000,
      );
    }

    return token;
  }

  async getBankForTransfer(payload: {
    amount: number;
    paymentDescription: string;
    customerName: string;
    customerEmail: string;
  }) {
    const token = await this.getAccessToken();
    const option = { headers: { Authorization: `Bearer ${token}` } };
    const resp = await this.client.post<{
      responseBody: { transactionReference: string };
    }>(
      '/merchant/transactions/init-transaction',
      {
        ...payload,
        bankCode: '058',
        paymentReference: Math.random().toString(32).substring(2),
        currencyCode: 'NGN',
        contractCode: config().monnify.contractCode,
        metaData: {
          hawayu: 'hello',
        },
      },
      option,
    );
    const res = await this.client.post<{
      responseBody: Record<string, unknown>;
    }>(
      '/merchant/bank-transfer/init-payment',
      {
        transactionReference: resp.responseBody.transactionReference,
        bankCode: '058',
      },
      option,
    );

    return res.responseBody;
  }

  async handleWebhook(payload: unknown, monnifySignature: string) {
    if (this.isWebhookPayload(payload)) {
      const hash = Crypto.createHmac('sha512', config().monnify.secret)
        .update(JSON.stringify(payload))
        .digest('hex');
      if (hash === monnifySignature) {
        const handler = this.webhookHandlers[payload.eventType];
        if (handler) {
          return handler.bind(this)(payload);
        }
      }
    }

    return null;
  }

  isWebhookPayload(payload: unknown): payload is WebhookPayload {
    return Util.isPriObj(payload) && !!payload.eventData && !!payload.eventType;
  }

  private async handleSuccessfulTransaction(payload: WebhookPayload) {
    const data = payload.eventData as {
      amountPaid: number;
      paymentReference: string;
    };
    const token = await this.db.authTokens.findOne({
      'meta.type': 'payment-reference',
      token: data.paymentReference,
      isUsed: { $ne: true },
    });
    if (token) {
      await Promise.all([
        this.db.authTokens.updateOne(
          { _id: token.id },
          { $set: { isUsed: true } },
        ),
        this.db.balances.findOneAndUpdate(
          {
            user: token.meta.user,
            deleted: { $ne: true },
          },
          { $inc: { amount: data.amountPaid } },
          { upsert: true },
        ),
      ]);
    }
  }
}
