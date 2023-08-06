import { BadRequestException, Injectable } from '@nestjs/common';
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
  TransferFailureData,
  TransferSuccessData,
  WebhookPayload,
} from './types';

@Injectable()
export class PaystackService implements PaymentProvider {
  private readonly name = 'Paystack';

  private readonly client: Http;

  private readonly webhookHandlers: Record<
    string,
    (payload: WebhookPayload, logger: Logger) => unknown
  >;

  constructor(
    private readonly logger: Logger,
    private readonly db: DatabaseService,
    private readonly paymentService: PaymentService,
  ) {
    const { paystack } = config();

    this.client = new Http({
      baseURL: paystack.url,
      headers: { Authorization: `Bearer ${paystack.secretKey}` },
    });

    this.webhookHandlers = {
      'charge.success': this.handleChargeSuccessEvent,
    };

    this.paymentService.registerPaymentProvider(this.name, this);
  }

  async chargeCard(payload: {
    user: UserDocument;
    card: CardDocument;
    amount: number;
    reference: string;
  }) {
    try {
      const { card, amount, reference } = payload;
      const res = await this.client.post('/transaction/charge_authorization', {
        email: card.email,
        amount: amount * 100,
        reference,
        authorization_code: card.meta.authorization,
      });
      const data = (res as Record<string, unknown>).data as Record<
        string,
        unknown
      >;

      if (
        !['Approved', 'success', 'approved'].includes(data.status as string)
      ) {
        throw new Error(data.gateway_response as string);
      }

      return data;
    } catch (error) {
      throw new BadRequestException(error.message);
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
