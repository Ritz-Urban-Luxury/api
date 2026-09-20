import { ConflictException } from '@nestjs/common';
import { UserService } from './user.service';

const userId = '64a000000000000000000001';

describe('UserService.deleteAccount', () => {
  const user = {
    email: 'user@example.com',
    id: userId,
    phoneNumber: '2348012345678',
  } as never;
  let db: any;
  let service: UserService;

  beforeEach(() => {
    const resolved = jest.fn().mockResolvedValue(undefined);
    db = {
      activities: { deleteMany: resolved },
      authTokens: { deleteMany: resolved },
      balances: {
        deleteMany: resolved,
        findOne: jest.fn().mockResolvedValue(null),
      },
      cards: { deleteMany: resolved },
      driverOnlineSessions: { updateMany: resolved },
      driverRideOffers: { deleteMany: resolved },
      messages: { deleteMany: resolved },
      rentals: { findOne: jest.fn().mockResolvedValue(null) },
      rides: { updateMany: resolved },
      trips: { findOne: jest.fn().mockResolvedValue(null) },
      users: {
        findOneAndUpdate: jest.fn().mockResolvedValue({ id: userId }),
      },
    };

    db.rides.exists = jest.fn().mockResolvedValue(false);

    service = Object.create(UserService.prototype);
    Object.assign(service as any, {
      db,
      finance: {
        prepareAccountClosure: jest.fn().mockResolvedValue(null),
        getDriverFinancialPosition: jest.fn(),
      },
      push: {},
    });
  });

  it('blocks deletion while a trip is active', async () => {
    db.trips.findOne.mockResolvedValue({ id: 'active-trip' });

    await expect(
      service.deleteAccount(user, { confirm: true }),
    ).rejects.toThrow(ConflictException);
    expect(db.users.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('blocks deletion while a rental is active', async () => {
    db.rentals.findOne.mockResolvedValue({ id: 'active-rental' });

    await expect(
      service.deleteAccount(user, { confirm: true }),
    ).rejects.toThrow('Complete or cancel your active car rental');
    expect(db.users.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('prepares an account-closure withdrawal before anonymising', async () => {
    await service.deleteAccount(user, { confirm: true });

    expect((service as any).finance.prepareAccountClosure).toHaveBeenCalledWith(
      user,
      { bankAccountId: undefined, destinationType: undefined },
    );
  });

  it('removes private records and anonymises the account', async () => {
    const result = await service.deleteAccount(user, { confirm: true });

    expect(db.cards.deleteMany).toHaveBeenCalledWith({ user: userId });
    expect(db.authTokens.deleteMany).toHaveBeenCalledWith({
      $or: [
        { 'meta.phoneNumber': '2348012345678' },
        { 'meta.email': 'user@example.com' },
      ],
    });
    expect(db.rides.updateMany).toHaveBeenCalledWith(
      { driver: userId, deleted: { $ne: true } },
      expect.objectContaining({
        $set: expect.objectContaining({ deleted: true, status: 'Offline' }),
      }),
    );
    expect(db.users.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: userId, deleted: { $ne: true } },
      expect.objectContaining({
        $set: expect.objectContaining({
          deleted: true,
          firstName: 'Deleted',
          pushDevices: [],
        }),
        $unset: expect.objectContaining({
          accountNumber: 1,
          email: 1,
          license: 1,
          phoneNumber: 1,
        }),
      }),
      { new: true, upsert: false },
    );
    expect(result).toEqual({
      deleted: true,
      deletedAt: expect.any(Date),
      closureRequest: null,
    });
  });
});
