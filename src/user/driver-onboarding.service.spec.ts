import { DriverOnboardingService } from './driver-onboarding.service';

describe('DriverOnboardingService', () => {
  const basePayload = {
    accountNumber: '0123456789',
    address: '1 Test Street',
    avatar: 'https://example.com/a.jpg',
    bank: 'Test Bank',
    bankHolderName: 'Ada Obi',
    firstName: 'Ada',
    lastName: 'Obi',
    license: 'https://example.com/l.jpg',
    licenseExpiry: '2030-01-01',
    licenseNumber: 'ABC123',
  };
  const vehicle = {
    brand: 'Toyota',
    category: 'Classic',
    color: 'Black',
    exteriorImages: ['https://example.com/e.jpg'],
    interiorImages: ['https://example.com/i.jpg'],
    model: 'Camry',
    registration: 'ABC123XY',
    seats: 4,
    year: '2020',
  };

  const setup = () => {
    const users = { updateUser: jest.fn(async (user) => user) };
    const rides = {
      createOnboardingRide: jest.fn(async () => ({ id: 'ride-1' })),
    };
    const service = new DriverOnboardingService(
      users as never,
      {} as never,
      rides as never,
    );
    return { rides, service };
  };

  it('lets an in-house driver finish onboarding without a vehicle', async () => {
    const { rides, service } = setup();

    const result = await service.complete(
      { id: 'driver-1', isDriver: true, isInHouseDriver: true } as never,
      basePayload as never,
    );

    expect(result.vehicle).toBeNull();
    expect(rides.createOnboardingRide).not.toHaveBeenCalled();
  });

  it('still requires a vehicle from regular drivers', async () => {
    const { service } = setup();

    await expect(
      service.complete(
        { id: 'driver-1', isDriver: true } as never,
        basePayload as never,
      ),
    ).rejects.toThrow('vehicle details are required');
  });

  it('creates the vehicle when one is provided', async () => {
    const { rides, service } = setup();

    await service.complete(
      { id: 'driver-1', isDriver: true } as never,
      { ...basePayload, vehicle } as never,
    );

    expect(rides.createOnboardingRide).toHaveBeenCalledTimes(1);
  });
});
