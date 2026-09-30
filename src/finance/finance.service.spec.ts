import { BadRequestException } from '@nestjs/common';
import { BankNameMatchStatus } from '../database/schemas/bank-account.schema';
import {
  PayoutDestinationType,
  PayoutRequestStatus,
  PayoutRequestType,
} from '../database/schemas/payout-request.schema';
import { FinanceService } from './finance.service';

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
