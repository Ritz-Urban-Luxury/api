import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { EndTripDTO } from './rides.dto';

describe('EndTripDTO', () => {
  it('accepts the complete live-location payload emitted by the driver app', async () => {
    const payload = plainToInstance(EndTripDTO, {
      location: {
        accuracy: 5,
        heading: 120,
        lat: 9.0676,
        lon: 7.397,
        recordedAt: '2026-10-26T18:44:00.000Z',
        sequence: 1793030640001,
        speed: 8.5,
      },
    });

    await expect(
      validate(payload, {
        forbidNonWhitelisted: true,
        whitelist: true,
      }),
    ).resolves.toEqual([]);
  });
});
