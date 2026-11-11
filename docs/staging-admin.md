# Staging administrator

Staging and production use separate databases. Provision an administrator in
staging rather than copying production customer data or sharing a database.

The command is intentionally guarded. It requires:

- `APP_ENV=staging`;
- the staging `DATABASE_URL`, including an explicit non-production database
  name;
- `STAGING_ADMIN_EMAIL` and a `STAGING_ADMIN_PASSWORD` of at least 12
  characters;
- exact command-line confirmation of both the normalized email and database
  name.

Run this from an authorized staging backend shell so `DATABASE_URL` comes from
the staging service environment:

```sh
APP_ENV=staging \
STAGING_ADMIN_EMAIL='admin@example.com' \
STAGING_ADMIN_PASSWORD='<strong password from your secret manager>' \
npm run provision:staging-admin -- \
  --confirm-email=admin@example.com \
  --confirm-database=rul-staging
```

Optional display-name variables are `STAGING_ADMIN_FIRST_NAME` and
`STAGING_ADMIN_LAST_NAME`.

The command creates or updates only the matching staging account. It resets
that account's staging password, grants the `Admin` role, marks it as a QA test
account, restores it if soft-deleted, and does not print credentials or the
database URL. It refuses production-like database names even if `APP_ENV` is
incorrectly configured as staging.

After provisioning, sign into the locally running Admin App. Its development
environment must point to `https://rul-api-staging.onrender.com`.
