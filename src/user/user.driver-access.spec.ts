import { ConflictException } from '@nestjs/common';
import { AdminAuditAction } from '../database/schemas/admin-audit-log.schema';
import { RideOfferOutcome } from '../database/schemas/driver-ride-offer.schema';
import { RideStatus } from '../database/schemas/rides.schema';
import {
  DriverAccessStatus,
  DriverReviewStatus,
} from '../database/schemas/user.schema';
import { UserService } from './user.service';

describe('UserService driver access', () => {
  const setup = () => {
    const session = {
      endSession: jest.fn(),
      withTransaction: jest.fn(async (work: () => Promise<void>) => work()),
    };
    const driver = {
      driverAccessStatus: DriverAccessStatus.Enabled,
      driverReviewStatus: DriverReviewStatus.Approved,
      email: 'driver@example.com',
      id: 'driver-1',
      isDriver: true,
      isVerified: true,
    };
    const db = {
      adminAuditLogs: { create: jest.fn() },
      driverHireBookings: { findOne: jest.fn().mockResolvedValue(null) },
      driverOnlineSessions: { updateMany: jest.fn() },
      driverRideOffers: { updateMany: jest.fn() },
      rides: {
        exists: jest.fn().mockResolvedValue(true),
        updateMany: jest.fn(),
      },
      trips: { findOne: jest.fn().mockResolvedValue(null) },
      users: {
        db: { startSession: jest.fn().mockResolvedValue(session) },
        findOne: jest.fn().mockResolvedValue(driver),
        updateOne: jest.fn(),
      },
    };
    const push = { sendToUser: jest.fn() };
    const service = new UserService(db as never, push as never, {} as never);
    jest.spyOn(service, 'getDriverDetail').mockResolvedValue({
      user: driver,
      rides: [],
    } as never);
    return { db, driver, push, service };
  };

  it('disables an approved driver and clears operational availability', async () => {
    const { db, push, service } = setup();

    await service.setDriverAccess({ id: 'admin-1' } as never, 'driver-1', {
      status: DriverAccessStatus.Disabled,
    });

    expect(db.users.updateOne).toHaveBeenCalledWith(
      { _id: 'driver-1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          driverAccessStatus: DriverAccessStatus.Disabled,
          isVerified: false,
        }),
      }),
      expect.any(Object),
    );
    expect(db.rides.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ driver: 'driver-1' }),
      expect.objectContaining({
        $set: { status: RideStatus.Offline },
        $unset: { location: 1 },
      }),
      expect.any(Object),
    );
    expect(db.driverOnlineSessions.updateMany).toHaveBeenCalled();
    expect(db.driverRideOffers.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: RideOfferOutcome.Pending }),
      expect.objectContaining({
        $set: expect.objectContaining({ outcome: RideOfferOutcome.TimedOut }),
      }),
      expect.any(Object),
    );
    expect(db.adminAuditLogs.create).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          action: AdminAuditAction.DriverAccessChanged,
          targetUserId: 'driver-1',
        }),
      ],
      expect.any(Object),
    );
    expect(push.sendToUser).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        app: 'driver',
        data: expect.objectContaining({ type: 'DriverDisabled' }),
      }),
    );
  });

  it('refuses to disable a driver during an active trip', async () => {
    const { db, service } = setup();
    db.trips.findOne.mockResolvedValue({ id: 'trip-1' });

    await expect(
      service.setDriverAccess({ id: 'admin-1' } as never, 'driver-1', {
        status: DriverAccessStatus.Disabled,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.users.updateOne).not.toHaveBeenCalled();
  });

  it('re-enables an approved driver without putting a vehicle online', async () => {
    const { db, driver, service } = setup();
    db.users.findOne.mockResolvedValue({
      ...driver,
      driverAccessStatus: DriverAccessStatus.Disabled,
      isVerified: false,
    });

    await service.setDriverAccess({ id: 'admin-1' } as never, 'driver-1', {
      status: DriverAccessStatus.Enabled,
    });

    expect(db.rides.exists).toHaveBeenCalled();
    expect(db.users.updateOne).toHaveBeenCalledWith(
      { _id: 'driver-1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          driverAccessStatus: DriverAccessStatus.Enabled,
          isVerified: true,
        }),
      }),
      expect.any(Object),
    );
    expect(db.rides.updateMany).not.toHaveBeenCalled();
  });
});
