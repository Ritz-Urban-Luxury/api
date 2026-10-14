import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  DEFAULT_VEHICLE_COLOURS,
  STARTER_CATALOGUE,
  VehicleOptionsService,
} from './vehicle-options.service';

const lean = <T>(value: T) => ({ lean: jest.fn().mockResolvedValue(value) });

describe('VehicleOptionsService', () => {
  function setup({
    rows = [] as {
      _id?: string;
      manufacturer: string;
      brand: string;
      year: number;
    }[],
    logos = [] as { slug: string; logoUrl: string; name?: string }[],
    settings = { colours: DEFAULT_VEHICLE_COLOURS, allowOther: true } as Record<
      string,
      unknown
    >,
  } = {}) {
    const db = {
      carBrands: {
        find: jest.fn().mockReturnValue(lean(rows)),
        insertMany: jest.fn().mockResolvedValue(undefined),
        updateMany: jest.fn().mockResolvedValue({ modifiedCount: 2 }),
      },
      carBrandLogos: {
        find: jest.fn().mockReturnValue(lean(logos)),
        exists: jest.fn().mockResolvedValue(null),
        updateOne: jest.fn().mockResolvedValue(undefined),
      },
      vehicleSettings: {
        findOneAndUpdate: jest.fn().mockResolvedValue(settings),
        updateOne: jest.fn().mockResolvedValue(undefined),
      },
    };
    return { service: new VehicleOptionsService(db as never), db };
  }

  describe('groupCatalogue', () => {
    it('groups models under their manufacturer with its logo', () => {
      const result = VehicleOptionsService.groupCatalogue(
        [
          { manufacturer: 'Toyota', brand: 'Corolla', year: 2012 },
          { manufacturer: 'Toyota', brand: 'Camry', year: 2015 },
          { manufacturer: 'Honda', brand: 'Accord', year: 2010 },
        ],
        [{ slug: 'toyota', logoUrl: 'https://cdn/toyota.png' }],
      );

      expect(result).toEqual([
        {
          name: 'Honda',
          slug: 'honda',
          logoUrl: null,
          models: [{ name: 'Accord', fromYear: 2010 }],
        },
        {
          name: 'Toyota',
          slug: 'toyota',
          logoUrl: 'https://cdn/toyota.png',
          models: [
            { name: 'Camry', fromYear: 2015 },
            { name: 'Corolla', fromYear: 2012 },
          ],
        },
      ]);
    });

    it('merges spelling variants and keeps the earliest year of a model', () => {
      const [mercedes] = VehicleOptionsService.groupCatalogue(
        [
          { manufacturer: 'Mercedes-Benz', brand: 'C-Class', year: 2016 },
          { manufacturer: 'Mercedes Benz', brand: 'C Class', year: 2012 },
          { manufacturer: 'mercedes-benz', brand: 'E-Class', year: 2014 },
        ],
        [{ slug: 'mercedesbenz', logoUrl: 'https://cdn/mb.png' }],
      );

      expect(mercedes).toEqual({
        name: 'Mercedes-Benz',
        slug: 'mercedesbenz',
        logoUrl: 'https://cdn/mb.png',
        models: [
          { name: 'C-Class', fromYear: 2012 },
          { name: 'E-Class', fromYear: 2014 },
        ],
      });
    });

    it('sorts model names the way people expect (3 Series before 5 Series)', () => {
      const [bmw] = VehicleOptionsService.groupCatalogue(
        [
          { manufacturer: 'BMW', brand: 'X5', year: 2010 },
          { manufacturer: 'BMW', brand: '5 Series', year: 2010 },
          { manufacturer: 'BMW', brand: '3 Series', year: 2010 },
        ],
        [],
      );

      expect(bmw.models.map((model) => model.name)).toEqual([
        '3 Series',
        '5 Series',
        'X5',
      ]);
    });
  });

  it('returns manufacturers, colours and the "Other" switch in one response', async () => {
    const { service } = setup({
      rows: [{ manufacturer: 'Toyota', brand: 'Corolla', year: 2010 }],
      settings: {
        colours: [{ label: 'Black', value: 'black' }],
        allowOther: false,
      },
    });

    await expect(service.getOptions()).resolves.toEqual({
      manufacturers: [
        expect.objectContaining({
          name: 'Toyota',
          models: [{ name: 'Corolla', fromYear: 2010 }],
        }),
      ],
      colours: [{ label: 'Black', value: 'black' }],
      allowOther: false,
    });
  });

  it('starts with the colours the driver app used to ship with', async () => {
    const { service, db } = setup();

    await service.getSettings();

    expect(db.vehicleSettings.findOneAndUpdate).toHaveBeenCalledWith(
      { key: 'default' },
      {
        $setOnInsert: {
          key: 'default',
          colours: DEFAULT_VEHICLE_COLOURS,
          allowOther: true,
        },
      },
      expect.anything(),
    );
  });

  describe('updateSettings', () => {
    it('cleans the colour list and drops duplicates', async () => {
      const { service, db } = setup();

      await service.updateSettings({
        colours: [' Black ', 'black', 'Champagne', ''],
        allowOther: false,
      });

      expect(db.vehicleSettings.updateOne).toHaveBeenCalledWith(
        { key: 'default' },
        {
          $set: {
            colours: [
              { label: 'Black', value: 'black' },
              { label: 'Champagne', value: 'champagne' },
            ],
            allowOther: false,
          },
        },
        { upsert: true },
      );
    });

    it('refuses an empty colour list', async () => {
      const { service } = setup();

      await expect(
        service.updateSettings({ colours: ['  '], allowOther: true }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  it('imports only the starter models that are missing', async () => {
    const { service, db } = setup({
      rows: [{ manufacturer: 'Toyota', brand: 'Corolla', year: 2012 }],
    });
    const total = Object.values(STARTER_CATALOGUE).flat().length;

    await expect(service.importStarterCatalogue()).resolves.toEqual({
      added: total - 1,
    });
    const inserted = db.carBrands.insertMany.mock.calls[0][0];
    expect(inserted).not.toContainEqual(
      expect.objectContaining({ manufacturer: 'Toyota', brand: 'Corolla' }),
    );
    expect(inserted).toContainEqual({
      manufacturer: 'Toyota',
      brand: 'Camry',
      year: 2003,
    });
  });

  describe('renameManufacturer', () => {
    it('renames the models and the logo together', async () => {
      const { service, db } = setup({
        rows: [
          {
            _id: 'a',
            manufacturer: 'Mercedes Benz',
            brand: 'C-Class',
            year: 2012,
          },
          {
            _id: 'b',
            manufacturer: 'mercedes-benz',
            brand: 'E-Class',
            year: 2012,
          },
          { _id: 'c', manufacturer: 'Toyota', brand: 'Camry', year: 2012 },
        ],
      });

      await service.renameManufacturer('Mercedes Benz', 'Mercedes-Benz');

      expect(db.carBrands.updateMany).toHaveBeenCalledWith(
        { _id: { $in: ['a', 'b'] } },
        { $set: { manufacturer: 'Mercedes-Benz' } },
      );
      expect(db.carBrandLogos.updateOne).toHaveBeenCalledWith(
        { slug: 'mercedesbenz', deleted: { $ne: true } },
        { $set: { name: 'Mercedes-Benz', slug: 'mercedesbenz' } },
      );
    });

    it('refuses to rename onto a manufacturer that already exists', async () => {
      const { service, db } = setup({
        rows: [
          { _id: 'a', manufacturer: 'Benz', brand: 'C-Class', year: 2012 },
          {
            _id: 'b',
            manufacturer: 'Mercedes-Benz',
            brand: 'E-Class',
            year: 2012,
          },
        ],
      });

      await expect(
        service.renameManufacturer('Benz', 'Mercedes Benz'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(db.carBrands.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('seedOnce', () => {
    it('adds the starter catalogue the first time the API starts', async () => {
      const { service, db } = setup();
      db.vehicleSettings.findOneAndUpdate
        .mockResolvedValueOnce({
          colours: DEFAULT_VEHICLE_COLOURS,
          allowOther: true,
        })
        .mockResolvedValueOnce({ catalogueSeededAt: new Date() });

      const result = await service.seedOnce();

      expect(result.seeded).toBe(true);
      expect(result.added).toBe(Object.values(STARTER_CATALOGUE).flat().length);
      expect(db.vehicleSettings.findOneAndUpdate).toHaveBeenLastCalledWith(
        { key: 'default', catalogueSeededAt: null },
        { $set: { catalogueSeededAt: expect.any(Date) } },
        { new: true },
      );
    });

    it('never seeds again, so models admins removed stay removed', async () => {
      const { service, db } = setup();
      db.vehicleSettings.findOneAndUpdate
        .mockResolvedValueOnce({
          colours: DEFAULT_VEHICLE_COLOURS,
          allowOther: true,
        })
        .mockResolvedValueOnce(null);

      await expect(service.seedOnce()).resolves.toEqual({
        seeded: false,
        added: 0,
      });
      expect(db.carBrands.insertMany).not.toHaveBeenCalled();
    });

    it('does not stop the API starting if the seed fails', async () => {
      const { service, db } = setup();
      db.vehicleSettings.findOneAndUpdate.mockRejectedValue(
        new Error('db down'),
      );

      await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    });
  });
});
