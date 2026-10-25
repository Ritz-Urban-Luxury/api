import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { TestAccountService } from './test-account.service';

describe('TestAccountService safety gates', () => {
  const admin = { id: 'admin-1' } as never;
  const purgeablePreview = {
    user: {
      id: 'user-1',
      email: 'test@example.com',
      phoneNumber: undefined,
      isTestAccount: true,
      testAccountPurpose: 'qa',
    },
    canPurge: true,
    blockers: [],
    warnings: [],
    counts: {},
    wallet: {
      amount: 0,
      cashAmount: 0,
      rideCreditAmount: 0,
      reservedAmount: 0,
      legacyPaystackTransactions: 0,
    },
    linkedNonTestUsers: [],
    assets: [],
  };

  it('requires the exact target identity before any destructive work', async () => {
    const service = new TestAccountService({} as never, {} as never);
    jest.spyOn(service, 'preview').mockResolvedValue(purgeablePreview as never);

    await expect(
      service.purge(admin, 'user-1', {
        confirmation: 'PURGE another@example.com',
        reason: 'Remove development data',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses deletion when the preview reports a safety blocker', async () => {
    const service = new TestAccountService({} as never, {} as never);
    jest.spyOn(service, 'preview').mockResolvedValue({
      ...purgeablePreview,
      canPurge: false,
      blockers: ['Account has trips involving non-test users'],
    } as never);

    await expect(
      service.purge(admin, 'user-1', {
        confirmation: 'PURGE test@example.com',
        reason: 'Remove development data',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not reset App Review data when no configured accounts exist', async () => {
    const service = new TestAccountService(
      { users: { find: jest.fn().mockResolvedValue([]) } } as never,
      {} as never,
    );

    await expect(service.resetAppReviewData(admin)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('requires DELETE confirmation for permanent deletion', async () => {
    const service = new TestAccountService({} as never, {} as never);
    jest.spyOn(service, 'preview').mockResolvedValue({
      ...purgeablePreview,
      user: { ...purgeablePreview.user, isTestAccount: false },
    } as never);

    await expect(
      service.purgePermanent(admin, 'user-1', {
        confirmation: 'PURGE test@example.com',
        reason: 'User requested permanent deletion',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('prevents a super administrator from deleting their own account', () => {
    const service = new TestAccountService({} as never, {} as never);
    expect(() =>
      service.purgePermanent({ id: 'user-1' } as never, 'user-1', {
        confirmation: 'DELETE test@example.com',
        reason: 'Self deletion attempt',
      }),
    ).toThrow(ConflictException);
  });
});
