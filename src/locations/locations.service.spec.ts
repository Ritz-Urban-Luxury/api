import { NotFoundException } from '@nestjs/common';
import { LocationsService } from './locations.service';

const queryResult = (value: unknown) => ({
  select: jest.fn().mockReturnValue({
    sort: jest.fn().mockResolvedValue(value),
  }),
  sort: jest.fn().mockResolvedValue(value),
});

describe('LocationsService', () => {
  const setup = () => {
    const db = {
      serviceLocations: {
        create: jest.fn(),
        exists: jest.fn().mockResolvedValue(true),
        find: jest.fn(),
        findOne: jest.fn(),
        findOneAndUpdate: jest.fn(),
        updateOne: jest.fn(),
      },
    };
    return { db, service: new LocationsService(db as never) };
  };

  it('only exposes active locations publicly in display order', async () => {
    const { db, service } = setup();
    const locations = [{ id: 'lagos', name: 'Lagos' }];
    db.serviceLocations.find.mockReturnValue(queryResult(locations));

    await expect(service.listPublic()).resolves.toEqual(locations);
    expect(db.serviceLocations.find).toHaveBeenCalledWith({
      active: true,
      deleted: { $ne: true },
    });
  });

  it('rejects a disabled or unknown registration location', async () => {
    const { db, service } = setup();
    db.serviceLocations.findOne.mockResolvedValue(null);

    await expect(service.getActiveOrFail('location-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('seeds the original registration locations on first use', async () => {
    const { db, service } = setup();
    db.serviceLocations.exists.mockResolvedValue(false);
    db.serviceLocations.updateOne.mockResolvedValue(undefined);
    db.serviceLocations.find.mockReturnValue(queryResult([]));

    await service.listPublic();

    expect(db.serviceLocations.updateOne).toHaveBeenCalledTimes(3);
    expect(db.serviceLocations.updateOne).toHaveBeenCalledWith(
      { code: 'lagos' },
      expect.objectContaining({
        $setOnInsert: expect.objectContaining({ name: 'Lagos', active: true }),
      }),
      { upsert: true },
    );
  });
});
