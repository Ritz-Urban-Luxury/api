import { HttpException, HttpStatus } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { Logger } from '../logger/logger.service';

/**
 * Counts a request against `key` and throws 429 once `max` is reached within the window.
 * If the cache is unavailable the request is let through rather than lost.
 */
export async function enforceRateLimit(
  cache: Cache,
  logger: Logger,
  options: { key: string; max: number; windowMs: number; message: string },
): Promise<void> {
  const { key, max, windowMs, message } = options;
  let count = 0;

  try {
    count = (await cache.get<number>(key)) ?? 0;
  } catch (error) {
    logger.warn(`Unable to read rate limit ${key}`, error);
    return;
  }

  if (count >= max) {
    throw new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
  }

  try {
    await cache.set(key, count + 1, windowMs);
  } catch (error) {
    logger.warn(`Unable to update rate limit ${key}`, error);
  }
}
