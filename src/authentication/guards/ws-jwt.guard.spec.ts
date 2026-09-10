import { ExecutionContext } from '@nestjs/common';
import { Socket } from 'socket.io';
import { WSJwtGuard } from './ws-jwt.guard';

describe('WSJwtGuard', () => {
  it('uses the websocket client as the Passport request', () => {
    const client = { handshake: {} } as Socket;
    const context = {
      switchToWs: () => ({ getClient: () => client }),
    } as unknown as ExecutionContext;
    const guard = new WSJwtGuard();

    expect(guard.getRequest(context)).toBe(client);
  });
});
