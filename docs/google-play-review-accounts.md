# Google Play reviewer accounts

The reviewer bypass is backend-only and is disabled unless all four production
environment variables are configured:

```env
PLAY_RIDER_REVIEW_EMAIL=rider-review@ritzurbanluxury.com
PLAY_RIDER_REVIEW_OTP=<unique-four-digit-code>
PLAY_DRIVER_REVIEW_EMAIL=driver-review@ritzurbanluxury.com
PLAY_DRIVER_REVIEW_OTP=<different-unique-four-digit-code>
```

Generate each OTP with a cryptographically secure tool and store it only in the
production secret manager. Never add the real values to `.env.example`, a mobile
build, source control, or deployment logs.

The rider reviewer account can also sign in with a phone number and reuses the
same `PLAY_RIDER_REVIEW_OTP`. Real riders only ever sign in with Google or a
phone number, never email, so store reviewers should be given the phone-number
credential below rather than the email one - it exercises the same flow a real
user goes through. The phone number itself is not a secret (it's meant to go
in review notes), so it has a safe default in code
(`PLAY_REVIEW_PHONE_NUMBERS` in `play-review-accounts.ts`). A deployment can
override that default with `PLAY_RIDER_REVIEW_PHONE_NUMBER`.
Only the rider account has a phone number configured; the driver reviewer
still signs in with email only.

After deploying the backend configuration, provision or repair the two accounts
against the intended production database:

```bash
npm run provision:play-reviewers -- --confirm
```

The command is idempotent. It creates a normal rider, a verified non-admin
driver, and an approved synthetic trip vehicle. Reviewer-email changes and
in-app account deletion are blocked.

Reviewer activity runs in an isolated sandbox:

- The reviewer driver can toggle the synthetic vehicle online and offline, but
  synthetic vehicles are excluded from real catalogues and driver matching.
- Rider trip requests create a zero-charge synthetic trip without dispatching,
  notifying, or paying a real driver.
- Rider hire requests create a zero-charge synthetic booking without reserving
  the real owner's vehicle, charging a payment method, or notifying the owner.
- Reviewer-created vehicles are automatically marked synthetic.

## Rider app (recommended: phone number)

```text
Phone number: 07064192718
Reusable OTP: [PLAY_RIDER_REVIEW_OTP from the production secret manager]

Instructions:
1. Enter the phone number above in the "Enter your number" screen.
2. Request the OTP as normal.
3. Enter the reusable four-digit OTP provided above.
4. The OTP does not expire and no SMS is actually sent - no access to a
   physical device or SIM for this number is required.
5. This is a dedicated account containing synthetic data. Trips and hire requests are simulated without real charges or dispatch.
```

## Rider app (fallback: email)

```text
Email: rider-review@ritzurbanluxury.com
Reusable OTP: [PLAY_RIDER_REVIEW_OTP from the production secret manager]

Instructions:
1. Choose Continue with email and enter the email address above.
2. Tap Continue.
3. Enter the reusable four-digit OTP provided above.
4. The OTP does not expire and no access to the email inbox is required.
5. This is a dedicated account containing synthetic data. Trips and hire requests are simulated without real charges or dispatch.
```

## Play Console: driver app

```text
Email: driver-review@ritzurbanluxury.com
Reusable OTP: [PLAY_DRIVER_REVIEW_OTP from the production secret manager]

Instructions:
1. Choose Continue with email and enter the email address above.
2. Tap Continue.
3. Enter the reusable four-digit OTP provided above.
4. The OTP does not expire and no access to the email inbox is required.
5. The synthetic account and vehicle are already approved. Online status is isolated from real riders and no real-world transactions occur.
```
