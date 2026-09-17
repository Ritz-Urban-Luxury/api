import { generateOtp, OTP_LENGTH, OTP_PATTERN } from './otp';

describe('OTP defaults', () => {
  it('generates four-digit codes', () => {
    expect(OTP_LENGTH).toBe(4);

    for (let index = 0; index < 20; index += 1) {
      expect(generateOtp()).toMatch(OTP_PATTERN);
    }
  });
});
