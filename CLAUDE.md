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

- Payments: a payment is real only after the server (a) verifies the Razorpay signature with an order ID from our own database, and (b) fetches the payment from Razorpay and checks status 'captured' and amount. Amounts always come from events.fee_paise, never from a request.
- Razorpay keys: test keys only (rzp_test_...) until a deliberate go-live. Never log or echo secrets.

- HTTP layer: validate every body with the shared zod schemas; never accept amounts, order IDs or BIBs from clients; error responses carry a stable code, never raw database errors.

## HTTP and payments rules

- The client never sends amounts, order IDs or BIBs. The server decides all three.
- /api/payments/verify must check the signature against the order ID stored on OUR server, then confirm with Razorpay that the payment is `captured` and the amount matches. Never skip either check.
- BIBs are issued only inside confirmOnlinePayment, in one transaction. No other code path may assign a BIB.
- Never log secrets, signatures or full request bodies.
- Every endpoint validates input with the zod schemas in @pawankhind/schemas.
