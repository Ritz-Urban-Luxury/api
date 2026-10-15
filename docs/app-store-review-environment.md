# App Store review environment

The driver review environment is isolated from live riders, vehicles, and
payments. The reusable driver account can generate a synthetic ride request
from the Home screen and can exercise account deletion. Its verified profile
and synthetic vehicles are restored on the next successful review login.

## Required environment variables

Configure the shared OTP and reviewer identifiers in the review API environment:

```text
PLAY_REVIEW_OTP=<shared four-digit code>
PLAY_RIDER_REVIEW_EMAIL=rider-review@ritzurbanluxury.com
PLAY_RIDER_DELETE_REVIEW_EMAIL=rider-delete-review@ritzurbanluxury.com
PLAY_DRIVER_REVIEW_EMAIL=driver-review@ritzurbanluxury.com
PLAY_DRIVER_DELETE_REVIEW_EMAIL=driver-delete-review@ritzurbanluxury.com
```

`PLAY_REVIEW_OTP` is the only reviewer OTP setting and is reused by all four
accounts. Store it in the deployment secret store, not in source control. The
reusable review phone number is a canonical constant in
`play-review-accounts.ts` and is shared by the rider and driver apps. Each app
sends its role to the API so the same credential resolves to the correct
account.

## Provision or restore the accounts

Run this against the same database used by the submitted build:

```bash
npm run provision:app-reviewers -- --confirm
```

The command is idempotent. Run it again before a new submission. It restores
the reviewer accounts and provisions the approved synthetic trip and hire
vehicles.

For a Docker deployment, set `PROVISION_APP_REVIEWERS=true`. The container will
run `yarn start:provision-app-reviewers`, which provisions the accounts and then
starts the API. Leave the variable unset or set it to `false` when automatic
startup provisioning is not wanted.

## Reviewer flow

1. Sign in to the driver app as `driver-review@ritzurbanluxury.com` using the
   shared fixed OTP, or use phone `07064192718` with the same OTP.
2. Grant location permission and go online with the preselected review vehicle.
3. Tap **Generate demo ride** on the Home screen.
4. Accept the request and exercise arrival, start, chat, safety reporting,
   completion, rating, and history using the normal app UI.
5. For deletion testing, use Settings > Account > Delete account while signed
   in as `driver-review@ritzurbanluxury.com`. The next successful login with
   that email or phone `07064192718` recreates the verified driver profile and
   reconnects both synthetic vehicles.

For the rider app, sign in with phone `07064192718` and the shared OTP. Use this
same account for Profile > Delete account > Review > Close account. The API
anonymizes the deleted account normally, then creates a fresh isolated review
account when `07064192718` next signs in with the shared OTP. No second rider
phone number is required.

The reusable rider sees an **App Review Demo** panel on Home. **Test a ride**
loads fixed Abuja pickup/destination locations and Cash payment before opening
the normal confirmation flow. **Test car hire** opens the isolated hire
catalogue containing `PLAY-REVIEW-HIRE`. The capability is granted by the API
only when both the reusable reviewer email and canonical phone number match.

The synthetic ride automatically progresses from driver approaching to driver
arrived after 5 seconds, starts 5 seconds later, and completes after another
30 seconds so the reviewer has time to inspect the active-trip features before
reaching the rating flow. Synthetic hire progresses from Pending to Accepted
after 5 seconds, starts 5 seconds later, and completes after 20 active seconds.
Every transition is restricted to records marked
`playReviewSynthetic`; no real driver, owner, or payment is involved.

Only the exact reusable driver review account can call the demo-offer endpoint.
Synthetic trips are zero-charge, excluded from live vehicle discovery, and do
not invoke the real payment processor. Rider review ride bookings start
immediately, and rider review hire bookings open immediately in the active
rental state, so review never waits for a real driver or vehicle owner.
