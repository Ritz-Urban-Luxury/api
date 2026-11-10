import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DriverHireVehicleDTO } from './driver-hire.dto';

const vehicle = {
  make: 'Toyota',
  model: 'Camry',
  year: 2022,
  color: 'Black',
  registration: 'ABC-123XY',
  vehicleType: 'Sedan',
  transmission: 'Automatic',
};

const validateVehicle = (payload: Record<string, unknown>) =>
  validate(plainToInstance(DriverHireVehicleDTO, payload), {
    forbidNonWhitelisted: true,
    whitelist: true,
  });

describe('DriverHireVehicleDTO', () => {
  it('accepts a vehicle without a photo', async () => {
    await expect(validateVehicle(vehicle)).resolves.toEqual([]);
  });

  it('accepts an https photo URL from the rider app upload', async () => {
    await expect(
      validateVehicle({
        ...vehicle,
        photoUrl:
          'https://res.cloudinary.com/ritz/image/upload/v1/vehicles/camry.jpg',
      }),
    ).resolves.toEqual([]);
  });

  it('rejects a photo that is not an https URL', async () => {
    const errors = await validateVehicle({
      ...vehicle,
      photoUrl: 'data:image/jpeg;base64,AAAA',
    });

    expect(errors.map((error) => error.property)).toEqual(['photoUrl']);
  });
});
