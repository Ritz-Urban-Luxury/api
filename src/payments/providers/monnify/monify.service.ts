import { CACHE_MANAGER, Inject, Injectable } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { Logger } from 'src/logger/logger.service';
import config from 'src/shared/config';
import { Http } from 'src/shared/http';

@Injectable()
export class MonnifyService {
  private readonly client: Http;

  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly logger: Logger,
  ) {
    this.client = new Http({ baseURL: `${config().monnify.apiUrl}/api/v1` });
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
        paymentReference: Math.random().toString(36).substring(2),
        currencyCode: 'NGN',
        contractCode: config().monnify.contractCode,
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
}
