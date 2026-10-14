import { AuthenticationService } from './authentication.service';

describe('AuthenticationService driver signup', () => {
  it('resolves an active location and forwards the verified phone OTP', async () => {
    const service = Object.create(AuthenticationService.prototype) as any;
    service.locationsService = {
      getActiveOrFail: jest.fn().mockResolvedValue({ id: 'location-id', name: 'Lagos' }),
    };
    service.signUp = jest.fn().mockResolvedValue({ token: 'token' });

    await expect(
      service.signUpDriver({
        email: 'driver@example.com',
        locationId: 'location-id',
        phoneNumber: '08012345678',
        phoneOtp: '1234',
      }),
    ).resolves.toEqual({ token: 'token' });

    expect(service.signUp).toHaveBeenCalledWith({
      city: 'Lagos',
      email: 'driver@example.com',
      firstName: undefined,
      lastName: undefined,
      phoneNumber: '08012345678',
      phoneOtp: '1234',
      serviceLocation: 'location-id',
      vehiclesInFleet: undefined,
    });
  });
});
