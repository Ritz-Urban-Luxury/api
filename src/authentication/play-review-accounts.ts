import * as Crypto from 'crypto';
import config from '../shared/config';
import { Util } from '../shared/util';
import { OTP_LENGTH, OTP_PATTERN } from './otp';

export type PlayReviewAccountKind = 'rider' | 'driver';

export type PlayReviewAccount = {
  email: string;
  kind: PlayReviewAccountKind;
  otp: string;
  phoneNumber?: string;
};

export const PLAY_REVIEW_EMAILS: Record<PlayReviewAccountKind, string> = {
  rider: 'rider-review@ritzurbanluxury.com',
  driver: 'driver-review@ritzurbanluxury.com',
};

// Real riders only ever sign in with Google or a phone number - never email -
// so the rider reviewer account needs to be reachable through that same
// phone-OTP flow for App Store review. Not a secret (it goes in the review
// notes), so it's a plain constant rather than an env var; the driver
// reviewer has no phone number configured yet.
export const PLAY_REVIEW_PHONE_NUMBERS: Partial<
  Record<PlayReviewAccountKind, string>
> = {
  rider: Util.formatPhoneNumber('07063650901', 'NG'),
};

const normalizeEmail = (email: string) => email.trim().toLowerCase();

export function getPlayReviewAccounts(): PlayReviewAccount[] {
  const configured = config().playReview;
  const accounts = (Object.keys(PLAY_REVIEW_EMAILS) as PlayReviewAccountKind[])
    .map((kind): PlayReviewAccount | null => {
      const email = configured[kind].email?.trim();
      const otp = configured[kind].otp?.trim();

      if (!email && !otp) {
        return null;
      }
      if (!email || !otp) {
        throw new Error(
          `Both Play ${kind} reviewer email and OTP must be configured`,
        );
      }

      const normalizedEmail = normalizeEmail(email);
      if (normalizedEmail !== PLAY_REVIEW_EMAILS[kind]) {
        throw new Error(
          `Play ${kind} reviewer email must be ${PLAY_REVIEW_EMAILS[kind]}`,
        );
      }
      if (!OTP_PATTERN.test(otp)) {
        throw new Error(
          `Play ${kind} reviewer OTP must contain ${OTP_LENGTH} digits`,
        );
      }

      return {
        email: normalizedEmail,
        kind,
        otp,
        phoneNumber: PLAY_REVIEW_PHONE_NUMBERS[kind],
      };
    })
    .filter((account): account is PlayReviewAccount => Boolean(account));

  if (accounts.length === 2 && accounts[0].otp === accounts[1].otp) {
    throw new Error('Play rider and driver reviewer OTPs must be different');
  }

  return accounts;
}

export function getPlayReviewAccount(
  email?: string | null,
): PlayReviewAccount | null {
  if (!email) {
    return null;
  }

  const normalizedEmail = normalizeEmail(email);
  return (
    getPlayReviewAccounts().find(
      (account) => account.email === normalizedEmail,
    ) || null
  );
}

export function playReviewOtpMatches(
  account: PlayReviewAccount,
  candidate: string,
): boolean {
  if (!OTP_PATTERN.test(candidate)) {
    return false;
  }

  const expectedBuffer = Buffer.from(account.otp);
  const candidateBuffer = Buffer.from(candidate);
  return (
    expectedBuffer.length === candidateBuffer.length &&
    Crypto.timingSafeEqual(expectedBuffer, candidateBuffer)
  );
}
