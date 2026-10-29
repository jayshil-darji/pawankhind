# Pawankhind Season-3: 5 km run registration

Monorepo (pnpm workspaces + Turborepo): the registration API in `services/registration`, the web app in `apps/web`, shared schemas in `packages/schemas`, CloudFront functions in `infra/edge` and Terraform in `infra/`.

## Local setup

### Prerequisites

- Node 24 (see `.nvmrc`) and pnpm 11 (`corepack enable` picks the version from `package.json`).
- Docker with Compose v2, for local Postgres and Redis.
- Razorpay **test** keys from the Razorpay dashboard (test mode). Never live keys on a local machine.

### Steps

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Create your local environment file and fill in the values (see the table below):

   ```bash
   cp .env.example .env
   ```

   `.env` is git-ignored. Never commit it, and never paste its contents anywhere (chat, issues, logs).

3. Start Postgres and Redis (only these two; the API runs on your machine in step 5):

   ```bash
   pnpm infra:up
   ```

   Postgres listens on `127.0.0.1:5432`. Redis listens on **`127.0.0.1:6380`** (not the default 6379).

4. Apply the database migrations:

   ```bash
   pnpm --filter @pawankhind/registration migrate
   ```

5. Start the API (port 3001, restarts on change):

   ```bash
   pnpm --filter @pawankhind/registration start:dev
   ```

   The startup log names the payment mode (`razorpay mode: test`), never a key. If a variable is missing or invalid, the API refuses to start and lists the variable names.

6. Optional, the web app (Vite proxies `/api` to the API on 3001):

   ```bash
   pnpm --filter @pawankhind/web dev
   ```

Stop Postgres and Redis with `pnpm infra:down`. To run the API as a container instead of step 5 (not needed day to day), use `pnpm infra:app`; it reads the same `.env`.

Tests do not need any of this: they start their own Postgres with testcontainers (`pnpm turbo test`, Docker required).

### Environment variables (`.env`)

| Variable                                            | Required                  | Default     | Local value / notes                                                                               |
| --------------------------------------------------- | ------------------------- | ----------- | ------------------------------------------------------------------------------------------------- |
| `APP_ENV`                                           | yes                       | none        | `dev`                                                                                             |
| `RAZORPAY_MODE`                                     | yes                       | none        | `test`. `live` is accepted only with `APP_ENV=prod`.                                              |
| `DATABASE_URL`                                      | yes                       | none        | `postgres://<POSTGRES_USER>:<POSTGRES_PASSWORD>@127.0.0.1:5432/<POSTGRES_DB>`                     |
| `REDIS_URL`                                         | yes                       | none        | `redis://127.0.0.1:6380`                                                                          |
| `RAZORPAY_KEY_ID`                                   | yes                       | none        | `rzp_test_<your test key id>`; must start with `rzp_test_` in test mode                           |
| `RAZORPAY_KEY_SECRET`                               | yes                       | none        | `<your test key secret>`                                                                          |
| `RAZORPAY_WEBHOOK_SECRET`                           | yes                       | none        | `<any value of 8+ characters>`; must match the test webhook in the dashboard if you test webhooks |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | yes (for `pnpm infra:up`) | none        | `<your choice>`; they must match `DATABASE_URL`                                                   |
| `PORT`                                              | no                        | `3001`      | Keep 3001: the Vite proxy points there.                                                           |
| `HOST`                                              | no                        | `127.0.0.1` |                                                                                                   |
| `TRUST_PROXY`                                       | no                        | `false`     | Leave unset locally. Behind CloudFront it is the hop count `1`, never `true`.                     |
| `RATE_LIMIT_SCALE`                                  | no                        | `1`         | Load tests only; refused unless `RAZORPAY_MODE=test`.                                             |
