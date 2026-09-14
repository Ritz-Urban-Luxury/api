import { ServiceUnavailableException } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { DatabaseService } from '../../../database/database.service';
import { Logger } from '../../../logger/logger.service';
import { PaymentService } from '../../payment.service';
import { PaystackService } from './paystack.service';

describe('PaystackService.getNigerianBanks', () => {
  const originalSecretKey = process.env.PAYSTACK_SECRET_KEY;
  let cache: Pick<Cache, 'get' | 'set'>;
  let clientGet: jest.Mock;
  let service: PaystackService;

  beforeEach(() => {
    process.env.PAYSTACK_SECRET_KEY = 'test-secret-key';
    cache = {
      get: jest.fn(),
      set: jest.fn(),
    };
    clientGet = jest.fn();
    service = new PaystackService(
      cache as Cache,
      {
        error: jest.fn(),
        warn: jest.fn(),
      } as unknown as Logger,
      {} as DatabaseService,
      {
        registerPaymentProvider: jest.fn(),
      } as unknown as PaymentService,
    );
    Object.defineProperty(service, 'client', {
      value: { get: clientGet },
    });
  });

  afterAll(() => {
    if (originalSecretKey === undefined) {
      delete process.env.PAYSTACK_SECRET_KEY;
    } else {
      process.env.PAYSTACK_SECRET_KEY = originalSecretKey;
    }
  });

  it('returns a cached bank list without calling Paystack', async () => {
    const cachedBanks = [
      {
        code: '044',
        name: 'Access Bank',
        slug: 'access-bank',
        type: 'nuban',
      },
    ];
    (cache.get as jest.Mock).mockResolvedValue(cachedBanks);

    await expect(service.getNigerianBanks()).resolves.toEqual(cachedBanks);
    expect(clientGet).not.toHaveBeenCalled();
  });

  it('fetches every page and returns active banks sorted by name', async () => {
    (cache.get as jest.Mock).mockResolvedValue(undefined);
    clientGet
      .mockResolvedValueOnce({
        status: true,
        message: 'Banks retrieved',
        data: [
          {
            active: true,
            code: '058',
            country: 'Nigeria',
            currency: 'NGN',
            id: 1,
            is_deleted: false,
            name: 'Zenith Bank',
            slug: 'zenith-bank',
            type: 'nuban',
          },
          {
            active: false,
            code: '999',
            country: 'Nigeria',
            currency: 'NGN',
            id: 2,
            is_deleted: false,
            name: 'Inactive Bank',
            slug: 'inactive-bank',
            type: 'nuban',
          },
        ],
        meta: { next: 'next-page' },
      })
      .mockResolvedValueOnce({
        status: true,
        message: 'Banks retrieved',
        data: [
          {
            active: true,
            code: '044',
            country: 'Nigeria',
            currency: 'NGN',
            id: 3,
            is_deleted: false,
            name: 'Access Bank',
            slug: 'access-bank',
            type: 'nuban',
          },
        ],
        meta: { next: null },
      });

    await expect(service.getNigerianBanks()).resolves.toEqual([
      {
        code: '044',
        name: 'Access Bank',
        slug: 'access-bank',
        type: 'nuban',
      },
      {
        code: '058',
        name: 'Zenith Bank',
        slug: 'zenith-bank',
        type: 'nuban',
      },
    ]);
    expect(clientGet).toHaveBeenNthCalledWith(2, '/bank', {
      params: expect.objectContaining({ next: 'next-page' }),
    });
    expect(cache.set).toHaveBeenCalledWith(
      'paystack:nigerian-banks',
      expect.any(Array),
      86400000,
    );
  });

  it('fails clearly when Paystack is not configured', async () => {
    delete process.env.PAYSTACK_SECRET_KEY;
    (cache.get as jest.Mock).mockResolvedValue(undefined);

    await expect(service.getNigerianBanks()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
