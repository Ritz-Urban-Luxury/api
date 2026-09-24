import { hash } from 'bcryptjs';
import { AuthenticationService } from './authentication.service';

describe('AuthenticationService JWT payload compatibility', () => {
  const service = Object.create(AuthenticationService.prototype) as {
    isValidJwtPayloadId: (
      user: Record<string, unknown>,
      payloadId: string,
    ) => Promise<boolean>;
  };
  const password = '$2a$08$storedPasswordHash';

  it('accepts the password-bound format used for new sessions', async () => {
    const payloadId = await hash(password, 8);

    await expect(
      service.isValidJwtPayloadId(
        { password, phoneNumber: '2348012345678' },
        payloadId,
      ),
    ).resolves.toBe(true);
  });

  it('keeps an OAuth setup token valid after a phone number is added', async () => {
    const payloadId = await hash(`undefined${password}`, 8);

    await expect(
      service.isValidJwtPayloadId(
        {
          oAuthProvider: 'Google',
          password,
          phoneNumber: '2348012345678',
        },
        payloadId,
      ),
    ).resolves.toBe(true);
  });

  it('continues accepting the legacy phone-bound token format', async () => {
    const payloadId = await hash(`2348012345678${password}`, 8);

    await expect(
      service.isValidJwtPayloadId(
        { password, phoneNumber: '2348012345678' },
        payloadId,
      ),
    ).resolves.toBe(true);
  });
});
