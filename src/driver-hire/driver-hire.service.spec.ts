import { BadRequestException, ConflictException } from '@nestjs/common';
import { DriverHireBookingStatus } from '../database/schemas/driver-hire-booking.schema';
import { DriverHirePlanType } from '../database/schemas/driver-hire-settings.schema';
import { DriverHireService } from './driver-hire.service';

describe('DriverHireService', () => {
  const settings = {
    active: true,
    hourlyRate: 8_000,
    minimumHours: 2,
    billingIncrementMinutes: 30,
    logisticsFee: 0,
    minimumAdvanceHours: 2,
    rescheduleNoticeHours: 24,
    termsVersion: '2026-11-11',
    hourlyPlan: {
      enabled: true,
      baseRate: 8_000,
      discountPercent: 0,
      includedDays: 1,
      hoursPerDay: 8,
      validityDays: 1,
      overtimeHourlyRate: 8_000,
      overtimeBillingIncrementMinutes: 30,
    },
    weeklyPlan: {
      enabled: true,
      baseRate: 100_000,
      discountPercent: 10,
      includedDays: 5,
      hoursPerDay: 8,
      validityDays: 7,
      overtimeHourlyRate: 8_000,
      overtimeBillingIncrementMinutes: 30,
    },
    monthlyPlan: {
      enabled: true,
      baseRate: 350_000,
      discountPercent: 0,
      includedDays: 22,
      hoursPerDay: 8,
      validityDays: 30,
      overtimeHourlyRate: 8_000,
      overtimeBillingIncrementMinutes: 30,
    },
    premiumMonthlyPlan: {
      enabled: true,
      baseRate: 450_000,
      discountPercent: 0,
      includedDays: 26,
      hoursPerDay: 10,
      validityDays: 30,
      overtimeHourlyRate: 8_000,
      overtimeBillingIncrementMinutes: 30,
    },
  };

  it('applies the minimum duration and billing increment', () => {
    expect(DriverHireService.billableHours(1, 2, 30)).toBe(2);
    expect(DriverHireService.billableHours(2.1, 2, 30)).toBe(2.5);
    expect(DriverHireService.calculateAmount(2.1, settings)).toBe(20_000);
    expect(DriverHireService.discountedRate(100_000, 10)).toBe(90_000);
  });

  it('returns the original booking when a submission is safely retried', async () => {
    const existing = {
      id: 'booking-1',
      clientRequestId: 'driver-hire-request-000001',
    };
    const service = new DriverHireService(
      {
        driverHireBookings: {
          findOne: jest.fn(async () => existing),
          create: jest.fn(),
        },
      } as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.createBooking(
        { id: 'user-1' } as never,
        {} as never,
        existing.clientRequestId,
      ),
    ).resolves.toBe(existing);
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
      driverHireBookings: { create, findOne: jest.fn(async () => null) },
    };
    const service = new DriverHireService(
      db as never,
      {} as never,
      {} as never,
    );
    const scheduledAt = new Date(Date.now() + 4 * 60 * 60 * 1000);

    await service.createBooking(
      { id: 'user-1' } as never,
      {
        scheduledAt: scheduledAt.toISOString(),
        estimatedHours: 2.1,
        pickup: { address: 'Maitama, Abuja', latitude: 9.1, longitude: 7.4 },
        completion: {
          address: 'Wuse 2, Abuja',
          latitude: 9.07,
          longitude: 7.48,
        },
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
      },
      'driver-hire-request-000001',
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        user: 'user-1',
        status: DriverHireBookingStatus.PendingReview,
        estimatedAmount: 20_000,
        pricing: expect.objectContaining({ hourlyRate: 8_000 }),
        pickup: expect.objectContaining({ coordinates: [9.1, 7.4] }),
        completion: expect.objectContaining({ coordinates: [9.07, 7.48] }),
      }),
    );
  });

  it('uses the configured package price and creates a schedule snapshot', async () => {
    const create = jest.fn(async (payload) => payload);
    const db = {
      driverHireSettings: {
        findOneAndUpdate: jest.fn(async () => settings),
      },
      driverHireTermsAcceptances: {
        findOne: jest.fn(async () => ({ acceptedAt: new Date('2026-11-11') })),
      },
      driverHireBookings: { create, findOne: jest.fn(async () => null) },
    };
    const service = new DriverHireService(
      db as never,
      {} as never,
      {} as never,
    );
    const scheduledAt = new Date(Date.now() + 4 * 60 * 60 * 1000);

    await service.createBooking(
      { id: 'user-1' } as never,
      {
        planType: DriverHirePlanType.Weekly,
        scheduledAt: scheduledAt.toISOString(),
        estimatedHours: 8,
        pickup: { address: 'Maitama, Abuja', latitude: 9.1, longitude: 7.4 },
        completion: {
          address: 'Wuse 2, Abuja',
          latitude: 9.07,
          longitude: 7.48,
        },
        servicePurpose: 'General driving',
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
      },
      'driver-hire-request-000002',
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        planType: DriverHirePlanType.Weekly,
        estimatedAmount: 90_000,
        packageSchedule: expect.objectContaining({
          workingDays: expect.any(Array),
        }),
        pricing: expect.objectContaining({
          baseRate: 100_000,
          discountPercent: 10,
        }),
      }),
    );
  });

  it('rounds package overtime using the booking pricing snapshot', async () => {
    const findOneAndUpdate = jest.fn(async (_filter, update) => update.$set);
    const db = {
      driverHireBookings: {
        findOne: jest.fn(async () => ({
          id: 'booking-1',
          planType: DriverHirePlanType.Weekly,
          status: DriverHireBookingStatus.InProgress,
          pricing: {
            hourlyRate: 8_000,
            overtimeHourlyRate: 8_000,
            overtimeBillingIncrementMinutes: 30,
          },
        })),
        findOneAndUpdate,
      },
    };
    const service = new DriverHireService(
      db as never,
      {} as never,
      {} as never,
    );

    const result = await service.updateOvertime(
      { id: 'admin-1' } as never,
      'booking-1',
      65,
    );

    expect(result).toEqual(
      expect.objectContaining({ overtimeMinutes: 65, overtimeAmount: 12_000 }),
    );
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'booking-1' },
      {
        $set: expect.objectContaining({
          overtimeMinutes: 65,
          overtimeAmount: 12_000,
          updatedBy: 'admin-1',
        }),
      },
      { new: true },
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

  it('generates a six-digit, short-lived handover code only after arrival', async () => {
    const findOneAndUpdate = jest.fn().mockResolvedValue({ id: 'booking-1' });
    const service = new DriverHireService(
      { driverHireBookings: { findOneAndUpdate } } as never,
      {} as never,
      {} as never,
    );
    jest.spyOn(service, 'getDriverAssignment').mockResolvedValue({
      id: 'booking-1',
      status: DriverHireBookingStatus.DriverArrived,
    } as never);

    const result = await service.generateHandoverCode(
      { id: 'driver-1' } as never,
      'booking-1',
    );

    expect(result.code).toMatch(/^\d{6}$/);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        assignedDriver: 'driver-1',
        status: DriverHireBookingStatus.DriverArrived,
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          handoverCodeHash: expect.any(String),
          handoverCodeAttempts: 0,
        }),
      }),
      { new: true },
    );
    expect(findOneAndUpdate.mock.calls[0][1].$set.handoverCodeHash).not.toBe(
      result.code,
    );
  });

  it('does not allow service to start before customer verification', async () => {
    const service = new DriverHireService(
      {} as never,
      {} as never,
      {} as never,
    );
    jest.spyOn(service, 'getDriverAssignment').mockResolvedValue({
      id: 'booking-1',
      status: DriverHireBookingStatus.DriverArrived,
    } as never);

    await expect(
      service.updateDriverStatus(
        { id: 'driver-1' } as never,
        'booking-1',
        DriverHireBookingStatus.InProgress,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects an expired handover code', async () => {
    const select = jest.fn().mockResolvedValue({
      id: 'booking-1',
      handoverCodeHash: 'hash',
      handoverCodeExpiresAt: new Date(Date.now() - 1_000),
      handoverCodeAttempts: 0,
    });
    const service = new DriverHireService(
      { driverHireBookings: { findOne: jest.fn(() => ({ select })) } } as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.verifyHandoverCode(
        { id: 'user-1' } as never,
        'booking-1',
        '123456',
      ),
    ).rejects.toThrow('expired');
  });
});
