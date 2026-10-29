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
- Never trust X-Forwarded-For unless TRUST_PROXY is set for a trusted proxy in front of the app. Behind CloudFront use the hop count TRUST_PROXY=1, never true (true trusts the client's own X-Forwarded-For). A hop count is safe only while the network lets nothing but that proxy reach the app.

## CloudFront and the dev API

- /api/\* goes from CloudFront to the instance's public DNS on HTTP port 80 (no cache, no gate). The security group allows port 80 only from the CloudFront origin-facing prefix list.
- The instance's public DNS changes on every stop/start, and is empty while the instance is stopped. Run terraform plan/apply only while the instance is RUNNING, and re-apply after each start. Until then CloudFront points at the old name and /api/\* returns 502/504.
- The gate function (default behaviour only) also does the SPA fallback: extension-less paths are rewritten to /index.html. There is no distribution-wide custom_error_response, because it would turn API 403/404 into 200 + HTML. At go-live remove only the password check from the function. Keep the rewrite.

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
- Remove the pre-launch password check from the CloudFront gate function (keep its SPA rewrite).
- Buy a domain and attach it to CloudFront and the API; update Razorpay and WhatsApp settings.
- Replace the placeholder route with the real one; get legal pages reviewed.

## Current state (2026-10-29)

- Server: registration API with rate limiting; health and terms declarations stored per registration (migration 003); Razorpay in test mode. Deployed to the dev EC2 instance by the Release workflow (SSM).
- Web: landing page, themed legal and result pages, registration form with consent checkboxes. Race start time is 07:00 IST (confirmed). Deployed to S3 + CloudFront (infra/envs/dev/web.tf) behind an organizer password gate (CloudFront Function, basic auth). Deploy job: deploy-web in .github/workflows/release.yaml.
- The dev instance's only inbound port is 80, from CloudFront. Reach it otherwise through an SSM port-forward. Stop it when idle. AWS commands need AWS_PROFILE=pawankhind AWS_REGION=ap-southeast-2.
- The CloudFront URL is organizer-only until go-live. There is no custom domain in dev.
- Dev contact number is the personal number (EVENT.contact). It must be replaced before go-live.

## Working rules for Claude Code

- Before starting any task: make sure the working tree is clean (git status). If it is not, stop and ask me.
- Then run git checkout main and git pull, and create a new local branch from the updated main. Prefix: feat/ for features, fix/ for bug fixes, infra/ for Terraform and deployment, chore/ for housekeeping. One task, one branch.
- Make small local commits with clear messages (conventional style: feat(scope): ..., fix(scope): ...). End each commit message with the attribution trailer lines the harness gives you.
- Never git push, merge, rebase onto shared branches, force-push, or delete remote branches. I review the commits and push manually.
- Never run terraform apply or terraform destroy. Run terraform fmt, validate and plan only, and show me the plan summary.
- Never start or stop EC2 instances or change AWS resources directly. Show me the command and I run it.
- Never print or commit secrets, .env files, or the gate password (TF_VAR_gate_password).
- Every new test must be able to fail: after writing it, tell me one mutation that makes it go red, and verify that it does.
- Finish each task by running pnpm format && pnpm lint && pnpm turbo build check-types test, and report the result.
- Explain non-obvious choices briefly. Prefer small, reviewable changes.

## Remaining work (in order)

1. Route /api/* from CloudFront to the EC2 API (no cache, no gate); the Razorpay webhook must keep working.
2. Admin side: manual/paper/cash/UPI registration (same ParticipantInput plus signed-paper-form ticks, and a channel parameter), dashboard with filters and Excel export, kit counter (kit days 15 and 16 Jan only).
3. BIB delivery by WhatsApp with SMS fallback and a retry queue.
4. Monitoring, alerts, and an admin report of paid-but-unfulfilled payments.
5. Pre-launch: domain, HTTPS end to end, event-only contact, real route, legal review, remove the gate.

## Current state (2026-10-29)

- Server: registration API with rate limiting; health and terms declarations stored per registration (migration 003); Razorpay in test mode. Deployed to the dev EC2 instance by the Release workflow (SSM).
- Web: landing page, themed legal and result pages, registration form with consent checkboxes. Race start time is 07:00 IST (confirmed). Deployed to S3 + CloudFront (infra/envs/dev/web.tf) behind an organizer password gate (CloudFront Function, basic auth). Deploy job: deploy-web in .github/workflows/release.yaml.
- The dev instance's only inbound port is 80, from CloudFront. Reach it otherwise through an SSM port-forward. Stop it when idle. AWS commands need AWS_PROFILE=pawankhind AWS_REGION=ap-southeast-2.
- The CloudFront URL is organizer-only until go-live. There is no custom domain in dev.
- Dev contact number is the personal number (EVENT.contact). It must be replaced before go-live.

## Working rules for Claude Code

- Before starting any task: make sure the working tree is clean (git status). If it is not, stop and ask me.
- Then run git checkout main and git pull, and create a new local branch from the updated main. Prefix: feat/ for features, fix/ for bug fixes, infra/ for Terraform and deployment, chore/ for housekeeping. One task, one branch.
- Make small local commits with clear messages (conventional style: feat(scope): ..., fix(scope): ...). End each commit message with the attribution trailer lines the harness gives you.
- Never git push, merge, rebase onto shared branches, force-push, or delete remote branches. I review the commits and push manually.
- Never run terraform apply or terraform destroy. Run terraform fmt, validate and plan only, and show me the plan summary.
- Never start or stop EC2 instances or change AWS resources directly. Show me the command and I run it.
- Never print or commit secrets, .env files, or the gate password (TF_VAR_gate_password).
- Every new test must be able to fail: after writing it, tell me one mutation that makes it go red, and verify that it does.
- Finish each task by running pnpm format && pnpm lint && pnpm turbo build check-types test, and report the result.
- Explain non-obvious choices briefly. Prefer small, reviewable changes.

## Remaining work (in order)

1. Route /api/* from CloudFront to the EC2 API (no cache, no gate); the Razorpay webhook must keep working.
2. Admin side: manual/paper/cash/UPI registration (same ParticipantInput plus signed-paper-form ticks, and a channel parameter), dashboard with filters and Excel export, kit counter (kit days 15 and 16 Jan only).
3. BIB delivery by WhatsApp with SMS fallback and a retry queue.
4. Monitoring, alerts, and an admin report of paid-but-unfulfilled payments.
5. Pre-launch: domain, HTTPS end to end, event-only contact, real route, legal review, remove the gate.
