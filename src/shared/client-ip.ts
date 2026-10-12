import { Request } from 'express';

/** Express resolves the visitor address using the configured trusted proxy hop. */
export function clientIp(req: Request): string {
  return req.ip || 'unknown';
}
