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

After deploying the backend configuration, provision or repair the two accounts
against the intended production database:

```bash
npm run provision:play-reviewers -- --confirm
```

The command is idempotent. It creates a normal rider, a verified non-admin
driver, and an approved synthetic trip vehicle. Payments, live ride/rental
bookings, driver online availability, reviewer-email changes, and in-app account
deletion are blocked for these accounts.

## Play Console: rider app

```text
Email: rider-review@ritzurbanluxury.com
Reusable OTP: [PLAY_RIDER_REVIEW_OTP from the production secret manager]

Instructions:
1. Choose Continue with email and enter the email address above.
2. Tap Continue.
3. Enter the reusable four-digit OTP provided above.
4. The OTP does not expire and no access to the email inbox is required.
5. This is a dedicated account containing synthetic data. Payments and live bookings are disabled.
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
5. The synthetic account and vehicle are already approved. Going online and real-world transactions are disabled.
```
