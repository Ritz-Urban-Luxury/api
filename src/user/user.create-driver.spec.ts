import { DriverReviewStatus } from '../database/schemas/user.schema';
import { UserService } from './user.service';

describe('UserService.createDriver', () => {
  const payload = {
    email: 'Driver@Example.com',
    firstName: ' Ada ',
    lastName: 'Obi',
    password: 'password123',
    phoneNumber: '08031234567',
  };

  const setup = () => {
    const create = jest.fn(async (doc) => ({ id: 'driver-1', ...doc }));
    const db = {
      users: { create, findOne: jest.fn().mockResolvedValue(null) },
    };
    const service = new UserService(db as never, {} as never, {} as never);
    return { create, service };
  };

  it('creates an unverified driver that still needs review by default', async () => {
    const { create, service } = setup();

    await service.createDriver(payload as never, { id: 'admin-1' } as never);

    const doc = create.mock.calls[0][0];
    expect(doc).toEqual(
      expect.objectContaining({
        isDriver: true,
        isVerified: false,
        mustChangePassword: true,
      }),
    );
    expect(doc.isInHouseDriver).toBeUndefined();
    expect(doc.driverReviewStatus).toBeUndefined();
  });

  it('registers an approved in-house driver when requested', async () => {
    const { create, service } = setup();

    await service.createDriver(
      { ...payload, inHouse: true } as never,
      { id: 'admin-1' } as never,
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        driverReviewStatus: DriverReviewStatus.Approved,
        driverReviewedBy: 'admin-1',
        isDriver: true,
        isInHouseDriver: true,
        isVerified: true,
      }),
    );
  });
});
