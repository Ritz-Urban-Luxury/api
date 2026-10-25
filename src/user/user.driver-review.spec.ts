import { BadRequestException } from '@nestjs/common';
import {
  DriverReviewField,
  DriverReviewStatus,
} from '../database/schemas/user.schema';
import { VehicleCategory } from '../database/schemas/rides.schema';
import { UserService } from './user.service';

describe('UserService driver application review', () => {
  const setup = () => {
    const session = {
      endSession: jest.fn(),
      withTransaction: jest.fn(async (work: () => Promise<void>) => work()),
    };
    const driver = {
      avatar: 'https://files/avatar.jpg',
      email: 'driver@example.com',
      id: 'driver-1',
      license: 'https://files/license.pdf',
      licenseExpiry: new Date(Date.now() + 86_400_000),
      licenseNumber: 'LIC-123',
    };
    const db = {
      adminAuditLogs: { create: jest.fn() },
      rides: {
        findOne: jest.fn().mockResolvedValue({
          brand: 'Mercedes-Benz',
          color: 'Black',
          id: 'ride-1',
          images: ['https://files/car.jpg'],
          model: 'E-Class',
          registration: 'ABC123XY',
        }),
        updateOne: jest.fn(),
      },
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

  it('approves and classifies the selected vehicle with the driver', async () => {
    const { db, push, service } = setup();

    await service.reviewDriverApplication(
      { id: 'admin-1' } as never,
      'driver-1',
      {
        status: DriverReviewStatus.Approved,
        vehicleCategory: VehicleCategory.Luxury,
        vehicleId: 'ride-1',
      },
    );

    expect(db.rides.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'ride-1', driver: 'driver-1' }),
      expect.objectContaining({
        $set: expect.objectContaining({
          approvalStatus: 'Approved',
          vehicleCategory: VehicleCategory.Luxury,
        }),
      }),
      expect.any(Object),
    );
    expect(db.users.updateOne).toHaveBeenCalledWith(
      { _id: 'driver-1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          driverReviewStatus: DriverReviewStatus.Approved,
          isVerified: true,
        }),
      }),
      expect.any(Object),
    );
    expect(push.sendToUser).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ app: 'driver' }),
    );
  });

  it('rejects changes to fields the admin did not request', async () => {
    const { driver, service } = setup();

    await expect(
      service.resubmitDriverApplication(
        {
          ...driver,
          driverReviewIssues: [
            {
              field: DriverReviewField.ProfilePhoto,
              reason: 'Use a clear photo',
            },
          ],
          driverReviewStatus: DriverReviewStatus.ChangesRequested,
        } as never,
        { licenseNumber: 'NEW-LICENCE' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires every requested correction before resubmission', async () => {
    const { driver, service } = setup();

    await expect(
      service.resubmitDriverApplication(
        {
          ...driver,
          driverReviewIssues: [
            {
              field: DriverReviewField.ProfilePhoto,
              reason: 'Use a clear photo',
            },
          ],
          driverReviewStatus: DriverReviewStatus.ChangesRequested,
        } as never,
        {},
      ),
    ).rejects.toThrow('profile photo correction is required');
  });
});
