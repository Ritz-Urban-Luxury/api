import { BadRequestException } from '@nestjs/common';
import { BankNameMatchStatus } from '../database/schemas/bank-account.schema';
import {
  PayoutDestinationType,
  PayoutRequestStatus,
  PayoutRequestType,
} from '../database/schemas/payout-request.schema';
import { WalletTransactionType } from '../database/schemas/wallet-transaction.schema';
import { FinanceService } from './finance.service';

describe('FinanceService.listWalletTransactions', () => {
  const queryResult = (
    rows: Array<{ toJSON: () => Record<string, unknown> }>,
  ) => ({
    populate: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue(rows),
  });

  it('returns a filtered wallet transaction page', async () => {
    const debit = {
      toJSON: () => ({
        id: 'wallet-1',
        type: WalletTransactionType.Debit,
        amountKobo: -2500,
        createdAt: new Date('2026-10-12T10:00:00Z'),
      }),
    };
    const walletQuery = queryResult([debit]);
    const walletTransactions = {
      find: jest.fn().mockReturnValue(walletQuery),
      countDocuments: jest.fn().mockResolvedValue(1),
    };
    const activities = {
      find: jest.fn(),
      countDocuments: jest.fn(),
    };
    const service = Object.create(FinanceService.prototype) as FinanceService;
    Reflect.set(service, 'db', {
      users: { distinct: jest.fn().mockResolvedValue([]) },
      walletTransactions,
      activities,
    });

    const result = await service.listWalletTransactions({
      page: 1,
      limit: 25,
      type: WalletTransactionType.Debit,
    });

    expect(walletTransactions.find).toHaveBeenCalledWith({
      deleted: { $ne: true },
      $nor: [
        { providerMode: 'test' },
        {
          appEnvironment: {
            $in: ['development', 'staging', 'test'],
          },
        },
      ],
      type: WalletTransactionType.Debit,
    });
    expect(walletTransactions.countDocuments).toHaveBeenCalledWith(
      expect.objectContaining({
        $nor: [
          { providerMode: 'test' },
          {
            appEnvironment: {
              $in: ['development', 'staging', 'test'],
            },
          },
        ],
      }),
    );
    expect(activities.find).not.toHaveBeenCalled();
    expect(result.docs).toEqual([
      expect.objectContaining({ id: 'wallet-1', source: 'wallet' }),
    ]);
    expect(result.totalDocs).toBe(1);
  });

  it('includes historical trip payment activity without creating ledger rows', async () => {
    const payment = {
      toJSON: () => ({
        id: 'activity-1',
        type: 'PaymentSucceeded',
        title: 'Credit card Payment',
        amount: 3200,
        createdAt: new Date('2026-10-11T10:00:00Z'),
        trip: 'trip-1',
      }),
    };
    const service = Object.create(FinanceService.prototype) as FinanceService;
    Reflect.set(service, 'db', {
      users: { distinct: jest.fn().mockResolvedValue([]) },
      walletTransactions: {
        find: jest.fn().mockReturnValue(queryResult([])),
        countDocuments: jest.fn().mockResolvedValue(0),
      },
      activities: {
        find: jest.fn().mockReturnValue(queryResult([payment])),
        countDocuments: jest.fn().mockResolvedValue(1),
      },
    });

    const result = await service.listWalletTransactions({ page: 1, limit: 50 });

    expect(result.docs).toEqual([
      expect.objectContaining({
        id: 'activity-1',
        type: 'PaymentSucceeded',
        amountKobo: 320000,
        provider: 'Card',
        providerReference: 'trip-1',
        source: 'trip-payment',
      }),
    ]);
  });
});

describe('FinanceService.prepareDriverAccountClosurePayout', () => {
  const driver = {
    email: 'driver@example.com',
    firstName: 'Test',
    id: '64a000000000000000000001',
    phoneNumber: '2348012345678',
  } as never;
  const bank = {
    accountNumber: '0123456789',
    bankCode: '058',
    bankName: 'GTBank',
    id: '64a000000000000000000002',
    resolvedAccountName: 'TEST DRIVER',
  };
  let service: FinanceService;
  let db: any;

  beforeEach(() => {
    db = {
      bankAccounts: { findOne: jest.fn().mockResolvedValue(bank) },
      payoutRequests: {
        create: jest.fn().mockImplementation((payload) =>
          Promise.resolve({
            ...payload,
            publicReference: 'PAY-TEST',
          }),
        ),
      },
    };
    service = Object.create(FinanceService.prototype);
    Object.assign(service as any, {
      db,
      getDriverFinancialPosition: jest.fn().mockResolvedValue({
        availablePayout: 12500,
      }),
      notifications: {
        sendEmail: jest.fn().mockResolvedValue(undefined),
        sendSMS: jest.fn().mockResolvedValue(undefined),
      },
    });
  });

  it('requires a verified payout account when earnings are available', async () => {
    await expect(
      service.prepareDriverAccountClosurePayout(driver),
    ).rejects.toThrow(BadRequestException);
    expect(db.payoutRequests.create).not.toHaveBeenCalled();
  });

  it('creates a final earnings payout using a verified account snapshot', async () => {
    await service.prepareDriverAccountClosurePayout(driver, bank.id);

    expect(db.bankAccounts.findOne).toHaveBeenCalledWith({
      _id: bank.id,
      user: '64a000000000000000000001',
      nameMatchStatus: BankNameMatchStatus.Matched,
      deleted: { $ne: true },
    });
    expect(db.payoutRequests.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amountKobo: 1250000,
        bankAccount: bank.id,
        debtOffsetKobo: 0,
        destinationSnapshot: {
          accountNumber: '0123456789',
          bankCode: '058',
          bankName: 'GTBank',
          resolvedAccountName: 'TEST DRIVER',
        },
        destinationType: PayoutDestinationType.BankAccount,
        status: PayoutRequestStatus.Requested,
        type: PayoutRequestType.DriverEarnings,
      }),
    );
  });

  it('does nothing when no earnings are available', async () => {
    (service as any).getDriverFinancialPosition.mockResolvedValue({
      availablePayout: 0,
    });

    await expect(
      service.prepareDriverAccountClosurePayout(driver),
    ).resolves.toBeNull();
    expect(db.bankAccounts.findOne).not.toHaveBeenCalled();
  });
});

describe('FinanceService.resolveAndSaveBankAccount', () => {
  const driverId = '64a000000000000000000001';
  const driver = {
    firstName: 'Test',
    id: driverId,
    lastName: 'Driver',
  } as never;
  let service: FinanceService;
  let db: any;

  beforeEach(() => {
    db = {
      bankAccounts: {
        findOneAndUpdate: jest.fn().mockImplementation((_filter, update) =>
          Promise.resolve({
            id: '64a000000000000000000002',
            ...update.$set,
          }),
        ),
        updateMany: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      },
      users: {
        updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      },
    };
    service = Object.create(FinanceService.prototype);
    Object.assign(service as any, {
      db,
      paystack: {
        resolveBankAccount: jest.fn().mockResolvedValue({
          account_name: 'TEST DRIVER',
        }),
      },
    });
  });

  it('makes a matching verified account the current payout account', async () => {
    const result = await service.resolveAndSaveBankAccount(driver, {
      accountNumber: '0123456789',
      bankCode: '058',
      bankName: 'GTBank',
    });

    expect(db.bankAccounts.updateMany).toHaveBeenCalledWith(
      {
        _id: { $ne: '64a000000000000000000002' },
        user: driverId,
        deleted: { $ne: true },
      },
      { $set: { isDefault: false } },
    );
    expect(db.bankAccounts.findOneAndUpdate).toHaveBeenCalledWith(
      {
        user: driverId,
        bankCode: '058',
        accountNumber: '0123456789',
      },
      expect.objectContaining({
        $set: expect.objectContaining({ isDefault: true }),
      }),
      { new: true, upsert: true },
    );
    expect(db.users.updateOne).toHaveBeenCalledWith(
      { _id: driverId },
      {
        $set: {
          accountNumber: '0123456789',
          bank: 'GTBank',
          bankHolderName: 'TEST DRIVER',
        },
      },
    );
    expect(result).toEqual(
      expect.objectContaining({
        accountNumber: '******6789',
        isDefault: true,
      }),
    );
  });

  it('does not replace the current payout account when the name needs review', async () => {
    (service as any).paystack.resolveBankAccount.mockResolvedValue({
      account_name: 'A DIFFERENT PERSON',
    });

    const result = await service.resolveAndSaveBankAccount(driver, {
      accountNumber: '0123456789',
      bankCode: '058',
      bankName: 'GTBank',
    });

    expect(db.bankAccounts.updateMany).not.toHaveBeenCalled();
    expect(db.users.updateOne).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        accountNumber: '******6789',
        nameMatchStatus: BankNameMatchStatus.Review,
      }),
    );
  });
});
