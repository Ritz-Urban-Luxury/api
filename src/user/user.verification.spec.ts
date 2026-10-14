import { BadRequestException } from '@nestjs/common';
import { UserService } from './user.service';

describe('UserService driver verification', () => {
  const setup = (user: Record<string, unknown>) => {
    const db = {
      users: {
        findOne: jest.fn().mockResolvedValue(user),
        findOneAndUpdate: jest.fn().mockResolvedValue({ ...user, isVerified: true }),
      },
    };
    const push = { sendToUser: jest.fn() };
    const service = new UserService(db as never, push as never, {} as never);
    return { db, push, service };
  };

  it('does not approve a driver without a profile photo', async () => {
    const { service } = setup({ id: 'driver', license: 'https://files/license.jpg' });

    await expect(
      service.setVerification('driver', { isVerified: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('approves a driver with both profile and license images', async () => {
    const { push, service } = setup({
      avatar: 'https://files/avatar.jpg',
      email: 'driver@example.com',
      id: 'driver',
      license: 'https://files/license.jpg',
    });

    await expect(
      service.setVerification('driver', { isVerified: true }),
    ).resolves.toMatchObject({ isVerified: true });
    expect(push.sendToUser).toHaveBeenCalled();
  });
});
