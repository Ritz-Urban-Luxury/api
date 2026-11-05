import { BadRequestException } from '@nestjs/common';
import { DriverHireBookingStatus } from '../database/schemas/driver-hire-booking.schema';
import { DriverHireService } from './driver-hire.service';

describe('DriverHireService', () => {
  const settings = {
    active: true,
    hourlyRate: 8_000,
    minimumHours: 2,
    billingIncrementMinutes: 30,
    logisticsFee: 2_000,
    minimumAdvanceHours: 2,
    termsVersion: '2026-11-05',
  };

  it('applies the minimum duration and billing increment', () => {
    expect(DriverHireService.billableHours(1, 2, 30)).toBe(2);
    expect(DriverHireService.billableHours(2.1, 2, 30)).toBe(2.5);
    expect(DriverHireService.calculateAmount(2.1, settings)).toBe(22_000);
  });

  it('creates a pending request with an immutable pricing snapshot', async () => {
    const create = jest.fn(async (payload) => ({
      id: 'booking-1',
      ...payload,
    }));
    const db = {
      driverHireSettings: {
        findOneAndUpdate: jest.fn(async () => settings),
      },
      driverHireTermsAcceptances: {
        findOne: jest.fn(async () => ({ acceptedAt: new Date('2026-11-05') })),
      },
      driverHireBookings: { create },
    };
    const service = new DriverHireService(
      db as never,
      {} as never,
      {} as never,
    );
    const scheduledAt = new Date(Date.now() + 4 * 60 * 60 * 1000);

    await service.createBooking({ id: 'user-1' } as never, {
      scheduledAt: scheduledAt.toISOString(),
      estimatedHours: 2.1,
      pickup: { address: 'Maitama, Abuja', latitude: 9.1, longitude: 7.4 },
      completion: { address: 'Wuse 2, Abuja', latitude: 9.07, longitude: 7.48 },
      servicePurpose: 'Business meetings',
      vehicle: {
        make: 'Toyota',
        model: 'Camry',
        year: 2022,
        color: 'Black',
        registration: 'ABC-123XY',
        vehicleType: 'Sedan',
        transmission: 'Automatic' as never,
      },
      handoverContactName: 'Ada Customer',
      handoverContactPhone: '+2348012345678',
      passengerCount: 1,
      paymentMethod: 'RULBalance',
      vehicleRoadworthyConfirmed: true,
      vehicleInsuredConfirmed: true,
      vehicleAuthorizationConfirmed: true,
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        user: 'user-1',
        status: DriverHireBookingStatus.PendingReview,
        estimatedAmount: 22_000,
        pricing: expect.objectContaining({ hourlyRate: 8_000 }),
        pickup: expect.objectContaining({ coordinates: [9.1, 7.4] }),
        completion: expect.objectContaining({ coordinates: [9.07, 7.48] }),
      }),
    );
  });

  it('requires acceptance of the current terms version', async () => {
    const db = {
      driverHireSettings: {
        findOneAndUpdate: jest.fn(async () => settings),
      },
      driverHireTermsAcceptances: { findOne: jest.fn(async () => null) },
    };
    const service = new DriverHireService(
      db as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.createBooking({ id: 'user-1' } as never, {} as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
