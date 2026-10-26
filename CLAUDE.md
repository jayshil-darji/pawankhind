# Pawankhind Season-3: 5KM run registration system

Learning project. Monorepo: pnpm workspaces + Turborepo, TypeScript (ESM, NodeNext).

## Layout

- services/registration: NestJS on Fastify, Postgres 17, Redis 7
- packages/schemas: shared constants and types
- infra/bootstrap, infra/envs/dev: Terraform (AWS ap-southeast-2)
- deploy/: compose file and remote deploy script (run on the server via SSM)

## Commands (run from repo root)

- pnpm turbo build check-types test
- pnpm lint, pnpm format:check
- pnpm infra:up (local Postgres/Redis in Docker)

## Rules

- Never read or print .env files, AWS credentials or Terraform state.
- Never run terraform apply/destroy or AWS write commands. Propose them; the human runs them.
- Never commit to main; work on a branch and open a PR. CI must pass.
- Pin major versions (TypeScript stays on 6.x until NestJS CLI supports 7).
- BIB numbers are issued only after a server-confirmed payment, inside one transaction. Never from the client.
- No secrets in the repo, logs or error messages.

## Database

- Schema changes only through numbered SQL files in services/registration/migrations (node-pg-migrate). Never edit an applied migration; add a new one.
- Money is integer paise. Times are timestamptz. Mobile numbers are 10 digits, no country code.
- Slot and BIB counters live on the events row and change only with single UPDATE statements inside transactions.

- Concurrency tests must be able to fail: after writing one, break the code on purpose and confirm the test goes red. Race tests force overlap (held-lock barrier); they never rely on timing luck.
