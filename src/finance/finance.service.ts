import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Types } from 'mongoose';
import { DatabaseService } from '../database/database.service';
import {
  BankAccountDocument,
  BankNameMatchStatus,
} from '../database/schemas/bank-account.schema';
import { DriverLedgerType } from '../database/schemas/driver-ledger.schema';
import {
  ActivePayoutRequestStatuses,
  PayoutDestinationType,
  PayoutRequestStatus,
  PayoutRequestType,
} from '../database/schemas/payout-request.schema';
import { PaymentMethod } from '../database/schemas/trips.schema';
import { UserDocument } from '../database/schemas/user.schema';
import { WalletTransactionType } from '../database/schemas/wallet-transaction.schema';
import { NotificationService } from '../notification';
import { PaystackService } from '../payments/providers/paystack/paystack.service';
import {
  AccountClosureDestinationDTO,
  CreateDriverPayoutDTO,
  ResolveBankAccountDTO,
  UpdateFinancialSettingsDTO,
} from './dto/finance.dto';

const toKobo = (amount: number) => Math.round(Number(amount || 0) * 100);
const fromKobo = (amountKobo: number) => Math.round(amountKobo) / 100;

@Injectable()
export class FinanceService {
  constructor(
    private readonly db: DatabaseService,
    private readonly paystack: PaystackService,
    private readonly notifications: NotificationService,
  ) {}

  async getSettings() {
    return this.db.financialSettings.findOneAndUpdate(
      { key: 'default' },
      {
        $setOnInsert: {
          key: 'default',
          driverCashDebtLimitKobo: 5_000_000,
          driverMinimumDepositPercent: 25,
          driverMinimumPayoutKobo: 100_000,
          driverSettlementDelayHours: 24,
        },
      },
      { new: true, upsert: true },
    );
  }

  async updateSettings(admin: UserDocument, payload: UpdateFinancialSettingsDTO) {
    const $set: Record<string, unknown> = { updatedBy: admin.id };
    if (payload.driverCashDebtLimit !== undefined) {
      $set.driverCashDebtLimitKobo = toKobo(payload.driverCashDebtLimit);
    }
    if (payload.driverMinimumDepositPercent !== undefined) {
      $set.driverMinimumDepositPercent = payload.driverMinimumDepositPercent;
    }
    if (payload.driverMinimumPayout !== undefined) {
      $set.driverMinimumPayoutKobo = toKobo(payload.driverMinimumPayout);
    }
    if (payload.driverSettlementDelayHours !== undefined) {
      $set.driverSettlementDelayHours = payload.driverSettlementDelayHours;
    }
    return this.db.financialSettings.findOneAndUpdate(
      { key: 'default' },
      { $set, $setOnInsert: { key: 'default' } },
      { new: true, upsert: true },
    );
  }

  private normalizeName(value?: string) {
    return (value || '')
      .normalize('NFKD')
      .replace(/[^a-zA-Z\s]/g, ' ')
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
  }

  private nameMatchStatus(user: UserDocument, resolvedName: string) {
    const profileTokens = this.normalizeName(`${user.firstName} ${user.lastName}`);
    const resolvedTokens = new Set(this.normalizeName(resolvedName));
    const matched =
      profileTokens.length >= 2 && profileTokens.every((token) => resolvedTokens.has(token));
    return matched ? BankNameMatchStatus.Matched : BankNameMatchStatus.Review;
  }

  async resolveAndSaveBankAccount(
    user: UserDocument,
    payload: ResolveBankAccountDTO,
  ) {
    const accountNumber = payload.accountNumber.replace(/\s/g, '');
    const resolved = await this.paystack.resolveBankAccount(
      accountNumber,
      payload.bankCode,
    );
    const nameMatchStatus = this.nameMatchStatus(user, resolved.account_name);

    const account = await this.db.bankAccounts.findOneAndUpdate(
      { user: user.id, bankCode: payload.bankCode, accountNumber },
      {
        $set: {
          user: user.id,
          bankCode: payload.bankCode,
          bankName: payload.bankName,
          accountNumber,
          resolvedAccountName: resolved.account_name,
          nameMatchStatus,
          verifiedAt: new Date(),
          deleted: false,
        },
      },
      { new: true, upsert: true },
    );

    return this.publicBankAccount(account);
  }

  async listBankAccounts(user: UserDocument) {
    let accounts = await this.db.bankAccounts
      .find({ user: user.id, deleted: { $ne: true } })
      .sort({ isDefault: -1, updatedAt: -1 });
    if (!accounts.length && user.accountNumber && user.bank) {
      try {
        const banks = await this.paystack.getNigerianBanks();
        const legacyBank = user.bank.trim().toLowerCase();
        const bank = banks.find(
          (item) =>
            item.code === user.bank ||
            item.name.toLowerCase() === legacyBank ||
            item.name.toLowerCase().includes(legacyBank) ||
            legacyBank.includes(item.name.toLowerCase()),
        );
        if (bank) {
          await this.resolveAndSaveBankAccount(user, {
            accountNumber: user.accountNumber,
            bankCode: bank.code,
            bankName: bank.name,
          });
          accounts = await this.db.bankAccounts
            .find({ user: user.id, deleted: { $ne: true } })
            .sort({ isDefault: -1, updatedAt: -1 });
        }
      } catch {
        // Legacy bank details remain available for manual re-verification.
      }
    }
    return accounts.map((account) => this.publicBankAccount(account));
  }

  private publicBankAccount(account: BankAccountDocument) {
    return {
      id: account.id,
      bankCode: account.bankCode,
      bankName: account.bankName,
      accountNumber: `******${account.accountNumber.slice(-4)}`,
      resolvedAccountName: account.resolvedAccountName,
      nameMatchStatus: account.nameMatchStatus,
      verifiedAt: account.verifiedAt,
      isDefault: account.isDefault,
    };
  }

  private async getBalanceParts(userId: string) {
    const balance = await this.db.balances.findOne({
      user: userId,
      deleted: { $ne: true },
    });
    const total = Math.max(0, Number(balance?.amount || 0));
    const rideCredit = Math.max(0, Number(balance?.rideCreditAmount || 0));
    const reserved = Math.max(0, Number(balance?.reservedAmount || 0));
    const cash = Math.max(
      0,
      balance?.cashAmount === undefined
        ? total - rideCredit - reserved
        : Number(balance.cashAmount || 0),
    );
    return { balance, total, cash, rideCredit, reserved };
  }

  async getAccountClosureAssessment(user: UserDocument) {
    const parts = await this.getBalanceParts(user.id);
    const originalCredit = await this.db.walletTransactions
      .findOne({
        user: user.id,
        type: WalletTransactionType.CashCredit,
        provider: 'Paystack',
        providerReference: { $exists: true },
        amountKobo: { $gte: toKobo(parts.cash) },
      })
      .sort({ createdAt: -1 });
    return {
      totalBalance: parts.total,
      refundableBalance: parts.cash,
      expiringRideCredit: parts.rideCredit,
      reservedBalance: parts.reserved,
      originalPaymentMethodEligible: Boolean(originalCredit),
      originalPaymentMethodLabel: originalCredit
        ? 'Original Paystack payment method'
        : null,
      requiresPayoutDestination: parts.cash > 0,
    };
  }

  async prepareAccountClosure(
    user: UserDocument,
    destination: AccountClosureDestinationDTO,
  ) {
    const parts = await this.getBalanceParts(user.id);
    if (parts.reserved > 0) {
      const existing = await this.db.payoutRequests.findOne({
        user: user.id,
        type: PayoutRequestType.RiderAccountClosure,
        status: { $in: ActivePayoutRequestStatuses },
        deleted: { $ne: true },
      });
      if (existing) return existing;
      throw new ConflictException(
        'Your refundable balance is already reserved; contact Ritz support',
      );
    }
    if (parts.cash <= 0) {
      if (parts.rideCredit > 0 && parts.balance) {
        await this.db.balances.updateOne(
          { _id: parts.balance.id },
          { $set: { amount: 0, cashAmount: 0, rideCreditAmount: 0 } },
        );
      }
      return null;
    }

    const destinationType =
      destination.destinationType || PayoutDestinationType.BankAccount;
    let bank: BankAccountDocument | null = null;
    let providerTransactionReference: string | undefined;
    let destinationSnapshot: Record<string, unknown>;

    if (destinationType === PayoutDestinationType.BankAccount) {
      if (!destination.bankAccountId) {
        throw new BadRequestException('A verified bank account is required');
      }
      bank = await this.db.bankAccounts.findOne({
        _id: destination.bankAccountId,
        user: user.id,
        deleted: { $ne: true },
      });
      if (!bank || bank.nameMatchStatus !== BankNameMatchStatus.Matched) {
        throw new BadRequestException(
          'The withdrawal bank account must match your Ritz profile name',
        );
      }
      destinationSnapshot = {
        bankCode: bank.bankCode,
        bankName: bank.bankName,
        accountNumber: bank.accountNumber,
        resolvedAccountName: bank.resolvedAccountName,
      };
    } else {
      const credit = await this.db.walletTransactions
        .findOne({
          user: user.id,
          type: WalletTransactionType.CashCredit,
          provider: 'Paystack',
          providerReference: { $exists: true },
          amountKobo: { $gte: toKobo(parts.cash) },
        })
        .sort({ createdAt: -1 });
      if (!credit?.providerReference) {
        throw new BadRequestException(
          'Original payment refund is unavailable; choose a bank account',
        );
      }
      providerTransactionReference = credit.providerReference;
      destinationSnapshot = {
        provider: 'Paystack',
        transactionReference: credit.providerReference,
      };
    }

    const providerReference = `rul_closure_${randomUUID()}`.slice(0, 50);
    const request = await this.db.payoutRequests.create({
      user: user.id,
      type: PayoutRequestType.RiderAccountClosure,
      status: PayoutRequestStatus.Requested,
      destinationType,
      amountKobo: toKobo(parts.cash),
      expiredRideCreditKobo: toKobo(parts.rideCredit),
      bankAccount: bank?.id,
      destinationSnapshot,
      notificationEmail: user.email,
      notificationPhone: user.phoneNumber,
      publicReference: `CLS-${randomUUID().split('-')[0].toUpperCase()}`,
      providerReference,
      providerTransactionReference,
    });

    await Promise.all([
      this.db.balances.updateOne(
        { _id: parts.balance.id },
        {
          $set: {
            amount: 0,
            cashAmount: 0,
            rideCreditAmount: 0,
            reservedAmount: parts.cash,
          },
        },
      ),
      this.db.walletTransactions.create({
        user: user.id,
        type: WalletTransactionType.Reserve,
        amountKobo: -toKobo(parts.cash),
        purpose: 'account-closure',
        providerReference,
      }),
    ]);

    this.notifyRequest(user, request.publicReference, 'Account closure received');
    return request;
  }

  async getDriverDebtNaira(driverId: string) {
    const rows = await this.db.driverLedgerEntries.aggregate<{ total: number }>([
      { $match: { driver: new Types.ObjectId(driverId), deleted: { $ne: true } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    return Math.max(0, rows[0]?.total || 0);
  }

  async getDriverFinancialPosition(driver: UserDocument) {
    const settings = await this.getSettings();
    const cutoff = new Date(
      Date.now() - settings.driverSettlementDelayHours * 60 * 60 * 1000,
    );
    const [earningsRows, requests, debtNaira, state] = await Promise.all([
      this.db.driverEarnings.aggregate<{ total: number }>([
        {
          $match: {
            driver: new Types.ObjectId(driver.id),
            deleted: { $ne: true },
            paymentMethod: { $in: [PaymentMethod.Card, PaymentMethod.RULBalance] },
            earnedAt: { $lte: cutoff },
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      this.db.payoutRequests.find({
        user: driver.id,
        type: PayoutRequestType.DriverEarnings,
        status: {
          $in: [...ActivePayoutRequestStatuses, PayoutRequestStatus.Paid],
        },
      }),
      this.getDriverDebtNaira(driver.id),
      this.ensureDriverRestrictionState(driver.id),
    ]);

    const earningsKobo = toKobo(earningsRows[0]?.total || 0);
    const settledOrReservedKobo = requests.reduce(
      (sum, request) =>
        sum + request.amountKobo + Number(request.debtOffsetKobo || 0),
      0,
    );
    const grossUnsettledKobo = Math.max(0, earningsKobo - settledOrReservedKobo);
    const debtKobo = toKobo(debtNaira);
    const debtOffsetKobo = Math.min(debtKobo, grossUnsettledKobo);
    const availablePayoutKobo = Math.max(
      0,
      grossUnsettledKobo - debtOffsetKobo,
    );
    const activeRequest = requests.find((request) =>
      ActivePayoutRequestStatuses.includes(request.status),
    );

    return {
      inAppEarnings: fromKobo(earningsKobo),
      cashCommissionDebt: fromKobo(debtKobo),
      debtOffset: fromKobo(debtOffsetKobo),
      availablePayout: fromKobo(availablePayoutKobo),
      pendingPayout: activeRequest ? fromKobo(activeRequest.amountKobo) : 0,
      minimumPayout: fromKobo(settings.driverMinimumPayoutKobo),
      debtLimit: fromKobo(settings.driverCashDebtLimitKobo),
      minimumDepositPercent: settings.driverMinimumDepositPercent,
      restriction: {
        restricted: Boolean(state.restricted),
        requiredDeposit: fromKobo(
          Math.max(
            0,
            Number(state.requiredDepositKobo || 0) -
              Number(state.paidTowardRestrictionKobo || 0),
          ),
        ),
      },
    };
  }

  async createDriverPayout(driver: UserDocument, payload: CreateDriverPayoutDTO) {
    const existing = await this.db.payoutRequests.findOne({
      user: driver.id,
      type: PayoutRequestType.DriverEarnings,
      status: { $in: ActivePayoutRequestStatuses },
    });
    if (existing) {
      throw new ConflictException('You already have a pending payout');
    }
    const position = await this.getDriverFinancialPosition(driver);
    const amountKobo = toKobo(payload.amount);
    if (amountKobo < toKobo(position.minimumPayout)) {
      throw new BadRequestException(
        `Minimum payout is ₦${position.minimumPayout.toLocaleString()}`,
      );
    }
    if (amountKobo > toKobo(position.availablePayout)) {
      throw new BadRequestException('Payout amount exceeds available balance');
    }
    const bank = await this.db.bankAccounts.findOne({
      _id: payload.bankAccountId,
      user: driver.id,
      nameMatchStatus: BankNameMatchStatus.Matched,
      deleted: { $ne: true },
    });
    if (!bank) {
      throw new BadRequestException('A verified matching bank account is required');
    }

    const request = await this.db.payoutRequests.create({
      user: driver.id,
      type: PayoutRequestType.DriverEarnings,
      status: PayoutRequestStatus.Requested,
      destinationType: PayoutDestinationType.BankAccount,
      amountKobo,
      debtOffsetKobo: toKobo(position.debtOffset),
      bankAccount: bank.id,
      destinationSnapshot: {
        bankCode: bank.bankCode,
        bankName: bank.bankName,
        accountNumber: bank.accountNumber,
        resolvedAccountName: bank.resolvedAccountName,
      },
      notificationEmail: driver.email,
      notificationPhone: driver.phoneNumber,
      publicReference: `PAY-${randomUUID().split('-')[0].toUpperCase()}`,
      providerReference: `rul_driver_${randomUUID()}`.slice(0, 50),
    });
    this.notifyRequest(driver, request.publicReference, 'Payout request received');
    return request;
  }

  async createDriverDebtPaymentReference(driver: UserDocument, amount: number) {
    const position = await this.getDriverFinancialPosition(driver);
    if (amount <= 0 || amount > position.cashCommissionDebt) {
      throw new BadRequestException('Enter an amount within your outstanding debt');
    }
    const reference = `rul_debt_${randomUUID()}`.slice(0, 50);
    await this.db.authTokens.create({
      token: reference,
      meta: {
        type: 'payment-reference',
        purpose: 'driver-debt-payment',
        user: driver.id,
        amount,
      },
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });
    if (!driver.email) {
      throw new BadRequestException(
        'Add an email address to your profile before making a payment',
      );
    }
    const checkout = await this.paystack.initializeTransaction({
      email: driver.email,
      amountKobo: toKobo(amount),
      reference,
      metadata: {
        purpose: 'driver-debt-payment',
        user: driver.id,
      },
    });
    return {
      reference,
      amount,
      checkoutUrl: checkout.authorization_url,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    };
  }

  async ensureDriverRestrictionState(driverId: string) {
    const [settings, debtNaira] = await Promise.all([
      this.getSettings(),
      this.getDriverDebtNaira(driverId),
    ]);
    const debtKobo = toKobo(debtNaira);
    let state = await this.db.driverFinancialStates.findOneAndUpdate(
      { driver: driverId },
      { $setOnInsert: { driver: driverId, restricted: false } },
      { new: true, upsert: true },
    );
    if (!state.restricted && debtKobo >= settings.driverCashDebtLimitKobo) {
      const percentageDeposit = Math.ceil(
        (debtKobo * settings.driverMinimumDepositPercent) / 100,
      );
      const belowThresholdDeposit =
        debtKobo - settings.driverCashDebtLimitKobo + 1;
      state = await this.db.driverFinancialStates.findOneAndUpdate(
        { _id: state.id, restricted: false },
        {
          $set: {
            restricted: true,
            restrictedDebtKobo: debtKobo,
            requiredDepositKobo: Math.max(
              percentageDeposit,
              belowThresholdDeposit,
            ),
            paidTowardRestrictionKobo: 0,
            restrictedAt: new Date(),
          },
        },
        { new: true },
      );
    }
    return state;
  }

  async canDriverReceiveRides(driverId: string) {
    const state = await this.ensureDriverRestrictionState(driverId);
    return !state.restricted;
  }

  async listPayoutRequests(status?: PayoutRequestStatus) {
    return this.db.payoutRequests
      .find({
        deleted: { $ne: true },
        ...(status ? { status } : {}),
      })
      .populate('user', 'firstName lastName email phoneNumber isDriver')
      .sort({ createdAt: -1 })
      .limit(250);
  }

  async approvePayout(admin: UserDocument, requestId: string) {
    const request = await this.db.payoutRequests.findOneAndUpdate(
      {
        _id: requestId,
        status: {
          $in: [
            PayoutRequestStatus.Requested,
            PayoutRequestStatus.FailedRetryable,
            PayoutRequestStatus.ActionRequired,
          ],
        },
        deleted: { $ne: true },
      },
      {
        $set: {
          status: PayoutRequestStatus.Approved,
          reviewedBy: admin.id,
          reviewedAt: new Date(),
        },
        $unset: { failureReason: 1 },
      },
      { new: true },
    );
    if (!request) throw new NotFoundException('Payout request not found');

    try {
      if (request.destinationType === PayoutDestinationType.OriginalPaymentMethod) {
        if (!request.providerTransactionReference) {
          throw new BadRequestException('Original transaction reference is unavailable');
        }
        const refund = await this.paystack.refund({
          transaction: request.providerTransactionReference,
          amount: fromKobo(request.amountKobo),
          currency: 'NGN',
          customer_note: 'Ritz account closure refund',
          merchant_note: request.publicReference,
        });
        return this.db.payoutRequests.findOneAndUpdate(
          { _id: request.id, status: PayoutRequestStatus.Approved },
          {
            $set: {
              status: PayoutRequestStatus.Processing,
              providerRefundId: String((refund as Record<string, unknown>)?.id || ''),
              providerMeta: refund,
            },
          },
          { new: true },
        );
      }

      const bank = await this.db.bankAccounts.findById(request.bankAccount);
      if (!bank) throw new BadRequestException('Payout bank account is unavailable');
      let recipientCode = bank.recipientCode;
      if (!recipientCode) {
        const recipient = await this.paystack.createTransferRecipient({
          accountName: bank.resolvedAccountName,
          accountNumber: bank.accountNumber,
          bankCode: bank.bankCode,
        });
        recipientCode = recipient.recipient_code;
        await this.db.bankAccounts.updateOne(
          { _id: bank.id },
          { $set: { recipientCode } },
        );
      }
      const transfer = await this.paystack.initiateTransfer({
        amountKobo: request.amountKobo,
        recipientCode,
        reason:
          request.type === PayoutRequestType.DriverEarnings
            ? 'Ritz driver earnings payout'
            : 'Ritz account closure withdrawal',
        reference: request.providerReference,
      });
      return this.db.payoutRequests.findOneAndUpdate(
        { _id: request.id, status: PayoutRequestStatus.Approved },
        {
          $set: {
            status: PayoutRequestStatus.Processing,
            providerTransferCode: transfer.transfer_code,
            providerMeta: transfer,
          },
        },
        { new: true },
      );
    } catch (error) {
      await this.db.payoutRequests.updateOne(
        { _id: request.id, status: PayoutRequestStatus.Approved },
        {
          $set: {
            status: PayoutRequestStatus.FailedRetryable,
            failureReason: (error as Error)?.message || 'Provider request failed',
          },
        },
      );
      throw error;
    }
  }

  async rejectPayout(admin: UserDocument, requestId: string, reason?: string) {
    const existing = await this.db.payoutRequests.findOne({
      _id: requestId,
      status: {
        $in: [
          PayoutRequestStatus.Requested,
          PayoutRequestStatus.ActionRequired,
          PayoutRequestStatus.FailedRetryable,
        ],
      },
    });
    if (!existing) throw new NotFoundException('Payout request not found');
    const nextStatus =
      existing.type === PayoutRequestType.RiderAccountClosure
        ? PayoutRequestStatus.ActionRequired
        : PayoutRequestStatus.Rejected;
    const request = await this.db.payoutRequests.findOneAndUpdate(
      {
        _id: requestId,
        status: {
          $in: [
            PayoutRequestStatus.Requested,
            PayoutRequestStatus.ActionRequired,
            PayoutRequestStatus.FailedRetryable,
          ],
        },
      },
      {
        $set: {
          status: nextStatus,
          reviewedBy: admin.id,
          reviewedAt: new Date(),
          rejectionReason: reason || 'Request rejected by finance',
        },
      },
      { new: true },
    );
    if (!request) throw new ConflictException('Payout request status changed');
    this.notifyStoredRequest(request, 'Your Ritz payout request needs attention');
    return request;
  }

  private notifyStoredRequest(
    request: {
      notificationEmail?: string;
      notificationPhone?: string;
      publicReference: string;
    },
    subject: string,
  ) {
    if (request.notificationEmail) {
      void this.notifications
        .sendEmail({
          recipient: request.notificationEmail,
          subject,
          template: 'financial-status.template.njk',
          context: {
            firstName: 'there',
            subject,
            reference: request.publicReference,
          },
        })
        ?.catch(() => undefined);
    }
    if (request.notificationPhone) {
      void Promise.resolve(
        this.notifications.sendSMS({
          to: request.notificationPhone,
          sms: `${subject}. Reference: ${request.publicReference}. Contact Ritz support for the required next step.`,
        }),
      ).catch(() => undefined);
    }
  }

  private notifyRequest(
    user: UserDocument,
    reference: string,
    subject: string,
  ) {
    if (user.email) {
      void this.notifications
        .sendEmail({
          recipient: { email: user.email, name: user.firstName },
          subject,
          template: 'financial-status.template.njk',
          context: {
            firstName: user.firstName || 'there',
            subject,
            reference,
          },
        })
        ?.catch(() => undefined);
    }
    if (user.phoneNumber) {
      void Promise.resolve(
        this.notifications.sendSMS({
          to: user.phoneNumber,
          sms: `${subject}. Reference: ${reference}. Approved withdrawals are expected within 7 days; Ritz will send status updates.`,
        }),
      ).catch(() => undefined);
    }
  }
}
