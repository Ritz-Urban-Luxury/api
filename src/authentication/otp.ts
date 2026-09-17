import * as Crypto from 'crypto';

export const OTP_LENGTH = 4;

export const OTP_PATTERN = new RegExp(`^\\d{${OTP_LENGTH}}$`);

export function generateOtp(): string {
  const minimum = 10 ** (OTP_LENGTH - 1);
  const maximum = 10 ** OTP_LENGTH;
  return Crypto.randomInt(minimum, maximum).toString();
}
