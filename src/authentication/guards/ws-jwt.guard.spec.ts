import { ExecutionContext } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
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

  it('disconnects a client whose account no longer exists', () => {
    const disconnect = jest.fn();
    const client = { disconnect, handshake: {} } as unknown as Socket;
    const context = {
      switchToWs: () => ({ getClient: () => client }),
    } as unknown as ExecutionContext;
    const guard = new WSJwtGuard();

    expect(() => guard.handleRequest(null, null, undefined, context)).toThrow(
      WsException,
    );
    expect(disconnect).toHaveBeenCalledWith(true);
  });
});
