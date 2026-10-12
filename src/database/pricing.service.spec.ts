import { BadRequestException, NotFoundException } from '@nestjs/common';
import { defaultPricing, PricingService } from './pricing.service';

describe('PricingService', () => {
  const originalEnv = { ...process.env };

  function setup(
    stored = defaultPricing(),
    zones: Record<string, unknown>[] = [],
  ) {
    const doc = {
      ...stored,
      populate: jest.fn().mockReturnThis(),
    };
    const db = {
      pricingSettings: {
        findOneAndUpdate: jest.fn().mockResolvedValue(doc),
      },
      pricingChanges: { create: jest.fn().mockResolvedValue(undefined) },
      pricingZones: {
        find: jest.fn().mockResolvedValue(zones),
        findOne: jest.fn(),
        create: jest.fn(async (input) => ({ id: 'zone-new', ...input })),
        findOneAndUpdate: jest.fn(async (_q, update) => update.$set),
        updateOne: jest.fn().mockResolvedValue(undefined),
      },
    };
    return { service: new PricingService(db as never), db };
  }

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('calculateFare', () => {
    const rates = {
      baseFare: 300,
      perKm: 100,
      perMinute: 20,
      minimumFare: 800,
    };

    it('adds base fare, distance and driving time', () => {
      // 300 + 100 × 12 km + 20 × 25 min = 2,000
      expect(PricingService.calculateFare(rates, 12_000, 25 * 60)).toBe(2000);
    });

    it('never charges less than the minimum fare', () => {
      expect(PricingService.calculateFare(rates, 1000, 60)).toBe(800);
    });

    it('rounds to whole naira', () => {
      expect(
        PricingService.calculateFare(
          { baseFare: 0, perKm: 85, perMinute: 0, minimumFare: 0 },
          1234,
          0,
        ),
      ).toBe(105);
    });
  });

  it('starts with the prices the app charged before pricing was configurable', async () => {
    delete process.env.DRIVER_COMMISSION_RATE;
    const { service } = setup();

    await expect(service.quote(12_000)).resolves.toEqual({
      classic: 1020,
      luxury: 1200,
    });
    await expect(service.quote(5000)).resolves.toEqual({
      classic: 700,
      luxury: 800,
    });
    expect(defaultPricing().commissionPercent).toBe(20);
  });

  it('estimates driving time from distance when the app sends only a distance', async () => {
    const { service } = setup({
      ...defaultPricing(),
      classic: { baseFare: 0, perKm: 0, perMinute: 10, minimumFare: 0 },
    });

    // 25 km at an average 25 km/h = 60 minutes × ₦10
    await expect(service.quote(25_000)).resolves.toMatchObject({
      classic: 600,
    });
  });

  it('records the rates and commission behind a booked fare', async () => {
    const { service } = setup();

    const fare = await service.fareFor('Luxury', 10_000, 900);

    expect(fare).toMatchObject({
      rideType: 'Luxury',
      perKm: 100,
      minimumFare: 800,
      commissionPercent: 20,
      distanceMeters: 10_000,
      durationSeconds: 900,
      amount: 1000,
    });
  });

  it('refuses to price hire cars, which owners price themselves', async () => {
    const { service } = setup();

    await expect(service.fareFor('Hire', 10_000)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  describe('chargeForTrip', () => {
    const fare = {
      rideType: 'Classic',
      baseFare: 0,
      perKm: 85,
      perMinute: 0,
      minimumFare: 700,
      commissionPercent: 20,
      distanceMeters: 5000,
      durationSeconds: 600,
      amount: 700,
      quotedAt: new Date(),
    };

    it('charges exactly the booked price when nothing changed', () => {
      expect(PricingService.chargeForTrip(fare)).toBe(700);
    });

    it('adds stops at the booked per-km rate', () => {
      expect(PricingService.chargeForTrip(fare, 2000)).toBe(870);
    });
  });

  it('saves new prices and keeps a record of the change', async () => {
    const { service, db } = setup();
    const next = {
      ...defaultPricing(),
      classic: { baseFare: 200, perKm: 90, perMinute: 5, minimumFare: 750 },
    };

    await service.update('admin-1', next);

    expect(db.pricingSettings.findOneAndUpdate).toHaveBeenLastCalledWith(
      { key: 'default' },
      { $set: { ...next, updatedBy: 'admin-1' } },
      expect.anything(),
    );
    expect(db.pricingChanges.create).toHaveBeenCalledWith({
      before: defaultPricing(),
      after: next,
      changedBy: 'admin-1',
    });
  });

  it('rejects a ride type that would cost nothing beyond its minimum', async () => {
    const { service, db } = setup();

    await expect(
      service.update('admin-1', {
        ...defaultPricing(),
        luxury: { baseFare: 0, perKm: 0, perMinute: 0, minimumFare: 800 },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.pricingChanges.create).not.toHaveBeenCalled();
  });

  it('reads settings from the database once, not on every quote', async () => {
    const { service, db } = setup();

    await service.quote(1000);
    await service.quote(2000);

    expect(db.pricingSettings.findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  describe('locations', () => {
    // Abuja city centre and the airport, which sits inside a wide Abuja zone.
    const abuja = {
      id: 'zone-abuja',
      name: 'Abuja',
      latitude: 9.0579,
      longitude: 7.4951,
      radiusKm: 40,
      classic: { baseFare: 0, perKm: 90, perMinute: 0, minimumFare: 750 },
      luxury: { baseFare: 0, perKm: 120, perMinute: 0, minimumFare: 900 },
      active: true,
    };
    const airport = {
      ...abuja,
      id: 'zone-airport',
      name: 'Airport',
      latitude: 9.0068,
      longitude: 7.2632,
      radiusKm: 3,
      classic: { baseFare: 1000, perKm: 90, perMinute: 0, minimumFare: 2000 },
    };
    const wuse: [number, number] = [9.0697, 7.4686];
    const atAirport: [number, number] = [9.0075, 7.2645];
    const lagos: [number, number] = [6.5244, 3.3792];

    it('uses the rates of the location the pickup is in', async () => {
      const { service } = setup(defaultPricing(), [abuja]);

      await expect(service.quote(10_000, 0, wuse)).resolves.toEqual({
        classic: 900,
        luxury: 1200,
        zone: 'Abuja',
      });
    });

    it('prefers the smallest location where they overlap', async () => {
      const { service } = setup(defaultPricing(), [abuja, airport]);

      await expect(service.quote(10_000, 0, atAirport)).resolves.toMatchObject({
        classic: 2000,
        zone: 'Airport',
      });
    });

    it('falls back to the default rates outside every location', async () => {
      const { service } = setup(defaultPricing(), [abuja]);

      await expect(service.quote(10_000, 0, lagos)).resolves.toEqual({
        classic: 850,
        luxury: 1000,
      });
    });

    it('uses default rates when an older app sends no pickup', async () => {
      const { service } = setup(defaultPricing(), [abuja]);

      await expect(service.quote(10_000, 0)).resolves.toEqual({
        classic: 850,
        luxury: 1000,
      });
    });

    it('ignores paused locations', async () => {
      const { service } = setup(defaultPricing(), [
        { ...abuja, active: false },
      ]);

      await expect(service.quote(10_000, 0, wuse)).resolves.not.toHaveProperty(
        'zone',
      );
    });

    it('records the location on the booked fare, with the global commission', async () => {
      const { service } = setup(defaultPricing(), [abuja]);

      await expect(
        service.fareFor('Classic', 10_000, 0, wuse),
      ).resolves.toMatchObject({
        zoneId: 'zone-abuja',
        zoneName: 'Abuja',
        perKm: 90,
        commissionPercent: 20,
        amount: 900,
      });
    });

    it('logs creating, editing and deleting a location', async () => {
      const { service, db } = setup();
      const input = { ...abuja };
      delete (input as { id?: string }).id;
      db.pricingZones.findOne.mockResolvedValue({
        id: 'a'.repeat(24),
        ...input,
      });

      await service.createZone('admin-1', input);
      await service.updateZone('admin-1', 'a'.repeat(24), {
        ...input,
        radiusKm: 30,
      });
      await service.deleteZone('admin-1', 'a'.repeat(24));

      expect(
        db.pricingChanges.create.mock.calls.map(([change]) => change.action),
      ).toEqual(['created', 'updated', 'deleted']);
      expect(db.pricingChanges.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'updated',
          zoneName: 'Abuja',
          before: expect.objectContaining({ radiusKm: 40 }),
          after: expect.objectContaining({ radiusKm: 30 }),
        }),
      );
    });

    it('rejects an unknown location id without hitting the database', async () => {
      const { service, db } = setup();

      await expect(
        service.deleteZone('admin-1', 'nope'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(db.pricingZones.findOne).not.toHaveBeenCalled();
    });
  });
});
