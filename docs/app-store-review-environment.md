# App Store review environment

The driver review environment is isolated from live riders, vehicles, and
payments. The reusable driver account can generate a synthetic ride request
from the Home screen. Account deletion is tested with a separate disposable
driver account so the main review login remains available.

## Required environment variables

Configure the shared OTP and reviewer identifiers in the review API environment:

```text
PLAY_REVIEW_OTP=<shared four-digit code>
PLAY_RIDER_REVIEW_EMAIL=rider-review@ritzurbanluxury.com
PLAY_RIDER_REVIEW_PHONE_NUMBER=07064192718
PLAY_RIDER_DELETE_REVIEW_EMAIL=rider-delete-review@ritzurbanluxury.com
PLAY_RIDER_DELETE_REVIEW_PHONE_NUMBER=07063650902
PLAY_DRIVER_REVIEW_EMAIL=driver-review@ritzurbanluxury.com
PLAY_DRIVER_DELETE_REVIEW_EMAIL=driver-delete-review@ritzurbanluxury.com
```

`PLAY_REVIEW_OTP` is reused by all four accounts. Store it in the deployment
secret store, not in source control. The former account-specific OTP variables
remain supported as a fallback, but the shared value takes precedence.

## Provision or restore the accounts

Run this against the same database used by the submitted build:

```bash
npm run provision:app-reviewers -- --confirm
```

The command is idempotent. Run it again before a new submission, or after Apple
deletes a disposable account. It restores the reusable rider and driver,
recreates both disposable deletion accounts, and provisions the approved
synthetic vehicle.

## Reviewer flow

1. Sign in to the driver app as `driver-review@ritzurbanluxury.com` using the
   shared fixed OTP.
2. Grant location permission and go online with the preselected review vehicle.
3. Tap **Generate demo ride** on the Home screen.
4. Accept the request and exercise arrival, start, chat, safety reporting,
   completion, rating, and history using the normal app UI.
5. For deletion testing, sign out and sign in as
   `driver-delete-review@ritzurbanluxury.com`. Use Settings > Account > Delete
   account. Do not use the reusable driver account for this test.

For the rider app, sign in to the reusable account with phone `07064192718`
and the shared OTP. Use `07063650902` and the same shared OTP only for Settings
> Account > Delete account. The deletion
account cannot create synthetic bookings and can be restored by rerunning the
provisioning command.

Only the exact reusable driver review account can call the demo-offer endpoint.
Synthetic trips are zero-charge, excluded from live vehicle discovery, and do
not invoke the real payment processor.
