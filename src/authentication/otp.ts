import * as Crypto from 'crypto';

export const OTP_LENGTH = 4;

export const OTP_PATTERN = new RegExp(`^\\d{${OTP_LENGTH}}$`);

/**
 * OTPs must never be persisted in plaintext.  The JWT secret is already a
 * required deployment secret, so it is a suitable server-side pepper for a
 * deterministic lookup without exposing the code in MongoDB.
 */
export function hashOtp(otp: string, secret?: string): string {
  return Crypto.createHmac('sha256', secret || 'ritz-development-otp-pepper')
    .update(otp)
    .digest('hex');
}

export function generateOtp(): string {
  const minimum = 10 ** (OTP_LENGTH - 1);
  const maximum = 10 ** OTP_LENGTH;
  return Crypto.randomInt(minimum, maximum).toString();
}
