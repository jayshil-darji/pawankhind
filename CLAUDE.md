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
- One registration has at most one payment order. Resume reuses it; nothing else may create a second. A second payment for a confirmed registration is recorded and flagged, never given a BIB.

## Web app rules

- The browser never decides "paid": show a BIB only when /api/payments/verify or /status returns `confirmed`.
- Never send amounts, order IDs or BIBs from the client. Only participant fields and the Razorpay payment id and signature.
- Use the shared zod schemas from @pawankhind/schemas for form validation. Never copy rules into the web app.
- The API is reached through the relative path /api (Vite proxy in dev). No hard-coded URLs or keys.

## Webhook rules

- Webhooks are verified against the RAW request body with a constant-time HMAC compare. Never re-serialise the JSON before checking.
- A valid signature is not proof of payment: always confirm with the Razorpay API (order, amount, `captured`) before issuing a BIB.
- Reply codes control retries: 400 for junk, 5xx only when a retry can help, 200 for everything else (log, don't retry).
- BIBs are still issued only by confirmOnlinePayment. The webhook and /verify share it and must stay idempotent.

## Background jobs

- Every background job (sweeper, reconciliation) must be wired into a module AND have a test that gets it from the real app (`app.get(...)`) and runs it. A tested function that nothing calls is a bug.
- Jobs never throw out of their timer callback: catch, log (no secrets), continue.
- Reconciliation never issues BIBs itself; it only calls the same confirm path as /verify and the webhook.

## Public endpoints

- Every public endpoint under /api has a RateLimit rule, except the webhook (Razorpay must never be throttled).
- Rate limiting fails open (log, allow). It protects us; it must never be the reason registrations stop.
- Never trust X-Forwarded-For unless TRUST_PROXY=true, which is only for a trusted proxy in front of the app.

## Web app: result page

- The BIB is shown only when the server status is "confirmed" and a bib is present. Never from browser storage, URL state or a payment callback.
- The result page lives at /registration/:id and must work on a cold reload. All state comes from GET /api/registrations/:id/status.
- Polling always has a stop condition (terminal status, unmount, time limit).

## Landing page

- src/route.ts is a PLACEHOLDER route. Replace it with one generated from the real GPX before going live.
- Registration dates in src/event.ts mirror the event row; the server is the authority. Replace them with GET /api/event.
- The map animation must respect prefers-reduced-motion.
- Artwork is supplied as files: src/assets/hero._, legend._, gallery/*. Compress to WebP (hero under 300 KB, gallery under 120 KB). Never hotlink images.
- src/route.ts is a PLACEHOLDER route. Replace it with one generated from the real GPX before going live.
- Dates in src/event.ts mirror the event row; the server is the authority. RACE_START is 07:00 IST (confirmed 2026-10-29).
- The page never mentions an age limit, and the partners section renders nothing until PARTNER_TIERS has entries.
- Terms, Privacy and Refund pages state only decided rules. They need an owner/legal review (incl. cancellation and weather) before going live.
- Fonts are self-hosted (@fontsource). No runtime requests to third-party hosts. No auto-rotating carousels.

## Validation and consent

- Validation messages are plain language for runners ("Enter your city"). Never ship Zod's default messages.
- POST /api/registrations is parsed with registrationRequestSchema: both declarations must be literally true. The server enforces it, not just the form.
- Declaration wording is versioned; changing it means a new version (recorded with the registration).
- Declarations are stored per registration (declarations_accepted_at + declarations_version), stamped by the server. Bump DECLARATION_VERSION in packages/schemas whenever the wording in RegistrationForm.tsx changes.
- Every registration, any channel, requires both declarations. Online: the runner ticks them. Admin entry: the admin ticks them to confirm the signed paper form is held. The admin form must use the same schema and label the boxes as "Signed paper form received". Keep the signed forms physically until after the event.

## Before go-live

- Replace the personal contact number (EVENT.contact) with an event-only number/email.
- Remove the pre-launch password gate from CloudFront.
- Buy a domain and attach it to CloudFront and the API; update Razorpay and WhatsApp settings.
- Replace the placeholder route with the real one; get legal pages reviewed.
