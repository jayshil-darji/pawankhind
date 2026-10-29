# Plan of record: launch prerequisites and admin side

Status: approved 2026-10-29 (rev 3). A1 and A2 are merged; A3 is in review. Each slice is a separate PR on its own branch.

## 1. Context

Online registration, Razorpay payments, BIB issue and CloudFront → API routing work on dev. Before real users arrive:

- **Launch prerequisites (Track L):** the API origin needs HTTPS and a stable hostname. Public registration opens 15 Nov 2026.
- **Admin side (Track A):** the 4 organisers need:
  - paper-form + cash entry;
  - T-shirt totals for the shirt order;
  - a kit counter for 15 and 16 Jan 2027;
  - a printed backup list, cash reconciliation, corrections, dashboard and exports.

Constraints: Rs 0 running cost apart from the domain and Route 53 (accepted). No weakening of the BIB, slot or payment rules in CLAUDE.md.

### Decisions

| Topic                | Decision                                                                                                                                                                                                                                                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Users                | 4 people. No registration desk. Any two run the kit counter (laptop or phone, internet available).                                                                                                                                                                                                                                                                    |
| Manual channel       | Paper form + cash only. Forms are entered as soon as they are received. Cash is banked. UPI payers register online through Razorpay; admins never handle UPI.                                                                                                                                                                                                         |
| Roles                | `admin` (everything) and `kit` (kit lookup and collection, T-shirt totals, operations export).                                                                                                                                                                                                                                                                        |
| Declarations (paper) | Same two declarations as online. Ticked by the admin as "Signed paper form received". Version `2026-10-paper-v1`. Signed forms are kept physically until after the event.                                                                                                                                                                                             |
| Receipts             | Pre-numbered receipt books. The receipt number is unique per event. The entering admin is the cash collector.                                                                                                                                                                                                                                                         |
| Window               | Same registration window as online: no paper entry before 15 Nov, after 8 Jan, or on race day. Capacity and slot rules are shared with online.                                                                                                                                                                                                                        |
| Corrections          | Name and mobile changes need a reason; old and new values are audited. DOB is locked. Once the kit is collected, the registration is fully locked.                                                                                                                                                                                                                    |
| Kit                  | The registered name is shown prominently, so photo ID can be checked against it (this enforces no BIB transfer).<br>Proxy collection only with the participant's ID copy or signed note **plus** the collector's own photo ID, recorded as proxy + name + evidence.<br>Windows: 15 Jan 2027 16:00–20:00 IST and 16 Jan 2027 10:00–20:00 IST. Never race day (17 Jan). |
| Exports              | xlsx only, no CSV.<br>**Operations:** no DOB or emergency contact, mobiles masked; admin + kit.<br>**Full:** admin only.<br>Both audited and sanitised against formula injection.                                                                                                                                                                                     |
| Retention            | Anonymise personal data 90 days after the event (17 Apr 2027), subject to legal review. Keep BIB, payment and receipt records for accounts.                                                                                                                                                                                                                           |
| DNS                  | Route 53.                                                                                                                                                                                                                                                                                                                                                             |
| Sessions             | Idle 30 min (admin) / 60 min (kit). 12 h absolute.                                                                                                                                                                                                                                                                                                                    |
| MFA                  | TOTP, mandatory. All 4 users have an authenticator app. No recovery codes: a lost phone means a CLI reset.                                                                                                                                                                                                                                                            |
| Gate                 | The Basic-auth gate stays on `/admin*` and `/api/admin/*` after go-live. Only the public site's gate is removed.                                                                                                                                                                                                                                                      |
| BIB rule             | Replaces "BIBs are issued only inside confirmOnlinePayment" in CLAUDE.md: **"BIBs are allocated only by allocateBib, called only from the two confirmation paths, each inside the transaction that records a captured payment."**                                                                                                                                     |

## 2. Sequencing and dates

1. **Next planning task, before any Track L slice is implemented:** production environment, backups and monitoring (section 13). Track L must target the environment that serves real users.
2. **Origin HTTPS is a launch blocker.** Public registration does not open until L1–L4 are live. If the domain is late, opening is delayed. The HTTP origin is never used for real users. To keep 15 Nov, the domain must be delegated by about 8 Nov.

| Slices             | Needed by                                                                                         | Why                                               |
| ------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| L1–L4              | before 15 Nov 2026 (target 12 Nov, leaving a test day)                                            | Public registration opens                         |
| A1–A7              | early Dec                                                                                         | Prerequisites of paper entry                      |
| A8 (+A9 to see it) | T-shirt vendor deadline (TBD)                                                                     | Shirt order. Until then use the SQL in section 11 |
| A10–A11            | early Dec                                                                                         | Paper entry                                       |
| A15                | before the first bank deposit of cash                                                             | Reconciliation                                    |
| A12–A14            | 15 Jan 2027 (target 8 Jan, leaving a week for a kit-counter rehearsal on phones)                  | Kit days                                          |
| A16, A17           | no hard date. A17 before BIB delivery (roadmap item 3), since a wrong mobile means no BIB message |                                                   |
| A18, A19           | no hard date, after A14                                                                           |                                                   |

## 3. Architecture

| Area            | Decision                                                                                                                                                                                                                                                                                                                                                                                          | Rejected (why)                                                                                                                                                                                                                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API             | `AdminModule` inside `services/registration`, routes under `/api/admin/*`. Same process, Postgres, Redis and deploy.                                                                                                                                                                                                                                                                              | Separate admin service: a second image, deploy, DB credentials and origin, for 4 users.                                                                                                                                                                                                                                                |
| UI              | Inside `apps/web` under `/admin/*`, lazy-loaded (`React.lazy`), so the public bundle carries no admin code. Same relative `/api` path.                                                                                                                                                                                                                                                            | Separate app: second build, S3 prefix and CloudFront behaviour, duplicated schema and styling setup. Code splitting gives the separate bundle anyway.                                                                                                                                                                                  |
| Authentication  | Self-managed:<br>• argon2id passwords (`@node-rs/argon2`, prebuilt binaries for `node:24-slim`)<br>• mandatory TOTP (`otpauth`)<br>• opaque server-side sessions in Redis<br>• enrolment by single-use link                                                                                                                                                                                       | Cognito: OIDC/hosted-UI flow, token validation, callback URLs tied to the domain, JWT revocation, more Terraform and IAM. Too much for 4 users.<br>Google sign-in: OAuth client and consent screen, personal Google accounts.<br>Magic links: need email sending.<br>Passkeys/WebAuthn: strongest, but more to build; a later upgrade. |
| User management | CLI only (`create`, `reset`, `disable`, `unlock`, `set-role`), run in an SSM session.                                                                                                                                                                                                                                                                                                             | Users screen and invite flow: not needed for 4 people.                                                                                                                                                                                                                                                                                 |
| Authorization   | Role → permissions map. A default-deny guard on every `/api/admin` handler. The UI only hides controls.                                                                                                                                                                                                                                                                                           | UI-only checks: bypassable with curl.                                                                                                                                                                                                                                                                                                  |
| BIB for cash    | `allocateBib(client, eventId)` in `PaymentsRepository`, called by `confirmOnlinePayment` and the new `recordPaperCashRegistration`, each in one transaction.                                                                                                                                                                                                                                      | Routing cash through `confirmOnlinePayment`: it is built around Razorpay orders and signatures, and faking those would blur the "payment is real" checks.                                                                                                                                                                              |
| CloudFront      | Three functions, all with the **same** Basic-auth realm:<br>• `site`: SPA rewrite + password; password removed at go-live<br>• `admin-gate` on `/admin*`: password + SPA rewrite; kept after go-live<br>• `api-admin-gate` on `/api/admin/*`: password only, **no** rewrite, ordered before `/api/*`; kept after go-live<br>Plus the managed `SecurityHeadersPolicy` (HSTS, frame deny, nosniff). | Reusing the site function on `/api/admin/*`: its SPA rewrite would send API calls to `/index.html`.                                                                                                                                                                                                                                    |
| Origin          | `origin.<domain>` on an Elastic IP. Caddy terminates TLS (DNS-01 via Route 53). CloudFront `https-only` with a secret `X-Origin-Verify` header that the app checks.                                                                                                                                                                                                                               | Plain HTTP origin: passwords, TOTP codes, cookies and personal data would cross the internet unencrypted.<br>Cert via HTTP-01: impossible, because the security group only admits CloudFront.                                                                                                                                          |

## 4. Data model

New numbered migrations only. Applied migrations are never edited. 004 (`payments.provider_mode`) and 005 (`environment_state`) came from the production-environment plan (P4), so A3 is 006 and the kit migration is 007.

### 006_admin_auth_audit.sql (A3)

- **`admin_users`**
  - `id uuid` PK
  - `username` (unique on `lower(username)`), `display_name`
  - `role CHECK (role IN ('admin','kit'))`
  - `password_hash`
  - `totp_secret_enc bytea`, `totp_last_step bigint` (replay guard), `mfa_enrolled_at`
  - `failed_logins int DEFAULT 0`, `locked_until`
  - `disabled_at`, `password_changed_at`, `created_at`
  - `CHECK ((password_hash IS NULL) = (mfa_enrolled_at IS NULL))`: no password-only accounts.
- **`admin_enrolments`**: `id`, `admin_user_id`, `token_hash bytea UNIQUE` (sha256), `expires_at`, `used_at`.
- **`audit_log`**
  - `id bigint` identity, `at timestamptz DEFAULT now()`
  - `actor_id` (FK `admin_users`, NULL for CLI or failed logins), `actor_kind` (`user` / `cli` / `anonymous`); `CHECK ((actor_kind = 'user') = (actor_id IS NOT NULL))`
  - `action`, `target_type`, `target_id`
  - `details jsonb`: codes, filters and row counts; old/new values only for corrections
  - `ip inet`
  - A trigger raises on UPDATE and DELETE (append-only), and a statement-level `BEFORE TRUNCATE` trigger raises too. Only the test `resetDatabase` lifts the TRUNCATE trigger, inside its own transaction.
  - **Failed logins:** `actor_kind = 'anonymous'`. The typed username is never stored; if it matches an existing account, only that account's id goes into `details` (`account_id`). Recorded in `COMMENT ON TABLE audit_log`.
  - These triggers stop mistakes, not a compromised app: the app still connects as the table owner until slice A3b.
- **No deleting records:** BEFORE DELETE triggers raise on `registrations`, `payments` and `admin_users` (users are disabled, never deleted).
- **Operator columns:** `registrations.entered_by` and `payments.collected_by` change from `text` to `uuid REFERENCES admin_users`. No admin rows exist yet. The `admin_needs_operator` check stays.
- **UPI only through Razorpay, as a DB rule:** `channel IN ('online','paper_form')` and `method IN ('razorpay','cash')`.
- **Cash payments**
  - `CHECK (method <> 'cash' OR (reference IS NOT NULL AND btrim(reference) <> '' AND collected_by IS NOT NULL AND status = 'captured'))`
  - Unique receipt: `(lower(btrim(reference))) WHERE method = 'cash'`. `payments` has no event column and this database holds one event, so the index is global.
  - `provider_mode` (004: NOT NULL, **no default**, `test`/`live`) records the environment's `RAZORPAY_MODE` on cash rows, so real cash counts as live for the reset guard. A10 writes it; 006 only adds a `COMMENT ON COLUMN`.
  - At most one cash payment per registration: `(registration_id) WHERE method = 'cash'`.
- **Extra checks:** an enrolled user has a TOTP secret; `admin_enrolments.token_hash` is exactly 32 bytes (sha256).
- **Existing rows are asserted, not rewritten:** a `DO` block refuses the migration, with counts only, if any row has a retired channel or method, or an operator set.
- **Confirmed-row guard trigger:** on UPDATE where `OLD.status = 'confirmed'`, it refuses changes to `bib_number`, `date_of_birth`, `event_id`, `channel`, `status`, `confirmed_at`, `declarations_accepted_at` and `declarations_version`. The existing confirm path only updates `held` or `expired` rows, so it is unaffected.

### Paper + cash entry (A10): no new tables

One transaction:

1. **Counter UPDATE, one statement:**
   `UPDATE events SET slots_taken = slots_taken + 1, next_bib = next_bib + 1 WHERE id = $1 AND slots_taken < capacity AND now() BETWEEN reg_opens_at AND reg_closes_at RETURNING next_bib - 1 AS bib`
   It goes through `allocateBib` and shares the window/capacity predicate with `reserveSlot`.
2. **Insert the registration:** `status = 'confirmed'`, `channel = 'paper_form'`, bib, `entered_by`, `declarations_accepted_at = now()`, `declarations_version = '2026-10-paper-v1'`.
3. **Insert the payment:** `cash`, `captured`. `amount_paise` comes from `events.fee_paise`. `reference` = receipt number. `collected_by` = the entering admin. `provider_mode` = the environment's `RAZORPAY_MODE` (the column has no default).
4. **Insert the audit row.**

Failure behaviour:

- **Same person already registered:** the existing `registrations_one_active_per_person` index also covers paper rows. A violation rolls everything back, including the counters, and returns `already_registered`.
- **Live online hold:** returns `already_registered` with the hold expiry.
- **Expired but unswept hold:** sweep once and retry, as `flow.start` does.

### 007_kit.sql (A12)

- **`kit_windows`**: `id`, `event_id`, `starts_at`, `ends_at`, `CHECK (ends_at > starts_at)`. Seeded with exactly:
  - `2027-01-15 16:00 → 20:00 +05:30`
  - `2027-01-16 10:00 → 20:00 +05:30`
- **`kit_collections`**
  - `registration_id uuid PRIMARY KEY REFERENCES registrations`: double collection is impossible in the database.
  - `collected_at timestamptz DEFAULT now()`
  - `collected_by uuid NOT NULL REFERENCES admin_users`
  - `id_checked boolean NOT NULL CHECK (id_checked)`: the collector's photo ID was checked.
  - `collected_by_proxy boolean NOT NULL`
  - `proxy_name text`
  - `proxy_evidence text CHECK (proxy_evidence IN ('id_copy','signed_note'))`
  - `CONSTRAINT kit_proxy_consistent CHECK ((collected_by_proxy AND proxy_name IS NOT NULL AND btrim(proxy_name) <> '' AND proxy_evidence IS NOT NULL) OR (NOT collected_by_proxy AND proxy_name IS NULL AND proxy_evidence IS NULL))`
  - A BEFORE DELETE trigger raises.
- **BEFORE INSERT trigger:** refuses unless the registration is `confirmed` **and** `now()` is inside one of the event's `kit_windows`.
- The confirmed-row guard is extended: any UPDATE of a registration that has a kit collection raises (fully locked).

## 5. API

All routes are under `/api/admin`. Schemas live in `packages/schemas/src/admin.ts`. JSON only. Stable error codes. `Cache-Control: no-store`.

| Method and path                                                        | Permission           | Notes                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /ping`                                                            | public               | Added in A4 for the gate test. In A7, removed or kept as `{ok:true}` with no data.                                                                                                                                                        |
| `GET /auth/enrol/:token` · `POST /auth/enrol`                          | public, rate-limited | GET validates the single-use token and returns the otpauth URI. POST sets the password and confirms a TOTP code.                                                                                                                          |
| `POST /auth/login`                                                     | public, rate-limited | `{username, password, totp}` in one step. Only ever answers `invalid_credentials` or `locked`.                                                                                                                                            |
| `POST /auth/logout` · `GET /auth/me`                                   | any session          |                                                                                                                                                                                                                                           |
| `POST /auth/password`                                                  | any session          | Needs the current password + TOTP. Revokes other sessions.                                                                                                                                                                                |
| `GET /stats/tshirts`                                                   | admin, kit           | Confirmed counts by size (the order figure), held counts separately, total. All six sizes, zero-filled.                                                                                                                                   |
| `POST /registrations/paper`                                            | admin                | Participant + both declarations `literal(true)` + `receiptNumber` + `cashReceived: literal(true)`. No amount field. Returns `{registrationId, bib}`.                                                                                      |
| `GET /kit/lookup?bib=` / `?mobile=`                                    | admin, kit           | Full 10-digit mobile only. Returns name, BIB, size, status, masked mobile, kit state (when, by, proxy), current/next window.                                                                                                              |
| `POST /kit/:registrationId/collect`                                    | admin, kit           | Body: `{idChecked: true, proxy: false}` or `{idChecked: true, proxy: true, proxyName, proxyEvidence}`.<br>Responses: `201`; `409 already_collected` {at, by}; `403 outside_kit_window`; `409 not_confirmed`.<br>Refusals are audited too. |
| `GET /print-list`                                                      | admin                | Backup list sorted by BIB. Audited.                                                                                                                                                                                                       |
| `GET /cash-reconciliation?from&to`                                     | admin                | By IST day × entering admin: receipt count, total paise, first/last receipt, receipts on expand.                                                                                                                                          |
| `GET /registrations?status&channel&tshirt&from&to&kit&q&page&pageSize` | admin                | `q` = name substring (LIKE-escaped), full mobile, or BIB. Masked mobiles. `pageSize ≤ 100`.                                                                                                                                               |
| `GET /registrations/:id`                                               | admin                | Full detail + payments + this record's audit trail. Audited (`registration.view`).                                                                                                                                                        |
| `PATCH /registrations/:id`                                             | admin                | Name, mobile, size, city, emergency contact. `reason` required when name or mobile changes. DOB is not in the schema.<br>Responses: `409 locked` after kit collection; `409 already_registered` on an index collision.                    |
| `GET /export/operations.xlsx?filters`                                  | admin, kit           | No DOB or emergency contact; masked mobile. Audited before the first byte.                                                                                                                                                                |
| `GET /export/full.xlsx?filters`                                        | admin                | Audited before the first byte. If the audit insert fails, no file is sent.                                                                                                                                                                |
| `GET /audit?filters`                                                   | admin                |                                                                                                                                                                                                                                           |

Rate limits are new `LIMITS` entries. They fail open as CLAUDE.md requires; lockout lives in Postgres, so brute-force protection survives a Redis outage.

| Endpoints           | Limit                      |
| ------------------- | -------------------------- |
| login, enrol        | 10 per 10 min per IP       |
| other admin routes  | 600 per 10 min per session |
| exports, print list | 10 per hour per user       |

## 6. Screens (`apps/web/src/admin/`, lazy-loaded)

- **`/admin/login`:** username, password, 6-digit code.
- **`/admin/enrol#token=…`:** the token is in the URL fragment, so CloudFront and S3 never log it. Set a password and scan the QR (rendered in the browser from the otpauth URI).
- **`/admin` (home):** T-shirt totals (copy-friendly), plus role-aware navigation.
- **`/admin/registrations/new`:** paper entry.
  - Fields driven by the shared schema; no copied rules.
  - Two boxes labelled "Signed paper form received" (health declaration, terms).
  - Receipt number, plus a "Rs 200 cash received" tick.
  - Confirm step. The BIB is shown only from the server response.
- **`/admin/kit`:** phone-first.
  - One search box (BIB or mobile).
  - The registered name is very large, then BIB and T-shirt size.
  - "Collected by: participant / someone else". For someone else: proxy name, evidence type (ID copy / signed note), and "Collector's photo ID checked".
  - The button stays disabled until the required ticks are done.
  - Red banner when already collected (who and when). Banner outside the windows, showing the next window.
- **`/admin/print-list`:** print CSS, sorted by BIB: BIB · name · size · ☐ self / ☐ proxy (name) · initials.
- **`/admin/cash`:** reconciliation table with totals, for checking against bank deposits.
- **`/admin/registrations`, `/admin/registrations/:id`:** filters, search, masked list; detail with audit trail and "Correct details" (reason field required for name/mobile).
- **`/admin/audit`:** filterable log.

## 7. Security checklist

- [ ] **Passwords**
  - argon2id with parameters tuned to about 200 ms on t3.small, at or above the OWASP minimums.
  - Unknown usernames still run a dummy verify, so timing doesn't reveal which usernames exist.
  - At least 12 characters, no composition rules (NIST 800-63B), checked against a common-password list.
- [ ] **TOTP**
  - Mandatory for both roles. SHA-1, 6 digits, 30 s, ±1 step. Replay guard via `totp_last_step`.
  - The secret is AES-256-GCM encrypted with `ADMIN_TOTP_KEY` from SSM (`/pawankhind/<env>/`).
  - `remote-deploy.sh` must be updated: its parameter-count check, and its `sed '/^RAZORPAY_/d'` line, which would otherwise duplicate the new key in `.env` on every deploy.
- [ ] **Lockout:** 5 consecutive failures → `locked_until = now() + 15 min`. Reset on success. CLI unlock. Every lock and unlock is audited.
- [ ] **Sessions**
  - 32 random bytes; Redis stores `sha256(id)`.
  - Idle 30 min (admin) / 60 min (kit), absolute 12 h. New ID at login.
  - The user row is re-read on every request, so disable or role change takes effect immediately. A per-user session set allows revoke-all.
  - **Fails closed** when Redis is down (unlike rate limiting).
- [ ] **Cookie:** `__Host-pk_admin; HttpOnly; Secure; SameSite=Strict; Path=/`, no Domain.
- [ ] **CSRF:** SameSite=Strict. Every non-GET request needs `Origin` equal to `ADMIN_ORIGIN` **and** `Content-Type: application/json`. No CORS for admin routes.
- [ ] **Permissions:** default-deny guard, plus a test that enumerates every `/api/admin` route.
- [ ] **First admin, with no secret in git or env:** `create-admin` runs in an SSM session and prints a single-use enrolment link (24 h, stored hashed). It refuses if an enrolled admin already exists, unless run as `reset`.
- [ ] **Client input:** amounts, BIBs and order IDs never come from the client. Amount = `events.fee_paise`.
- [ ] **Origin:** origin TLS + `X-Origin-Verify` (L3). The only exception is the exact health paths.
- [ ] **`TRUST_PROXY=2` behind Caddy** (L3 explains why).
- [ ] **Gates:** the same Basic-auth realm on all three gate functions. The admin gates stay after go-live.
- [ ] **Tests never DELETE** from protected tables. The app never TRUNCATEs.

## 8. Personal data, logging and retention

- **Lists** show name, BIB, masked mobile (`98******47`), size, status and channel. No DOB or emergency contact.
- **Detail view** shows everything and is audited.
- **Kit lookup** needs the full BIB or the full 10-digit mobile (no browsing). It shows name, BIB, size and masked mobile.
- **Exports:** operations (masked, no DOB or emergency contact) for admin + kit; full for admin only. Both audited with filters and row count.
- **Logs:** never participant fields, request bodies, cookies, Authorization headers, passwords, TOTP codes, enrolment tokens or the origin-verify secret. Log IDs and error codes only. Tests capture logs during the risky flows and check this.
- **Browser:** admin data stays in memory only; nothing in localStorage. `Cache-Control: no-store`.
- **Retention:** anonymise personal fields in `registrations` and in correction details in `audit_log` on 17 Apr 2027. Keep BIB, payment and receipt data. Subject to legal review, and stated in the Privacy page. The job itself is out of scope here.

## 9. Offline risk at the kit counter

Internet is expected.

- **Mitigations:**
  - a second phone's hotspot;
  - the printed list (A14), printed on the morning of each kit day, so day 2 reflects day 1.
- **If the system is unreachable:**
  - tick the paper list with initials, and note proxy name and evidence;
  - enter each collection once back online during the same window;
  - keep one master paper list at the counter to avoid handing out a kit twice.
- Back-entering collections after a window has closed is not built (out of scope).

## 10. Slices

Rules for every slice:

- One PR per slice.
- Each new test is shown red by its named mutation, then restored.
- Every PR ends with `pnpm format && pnpm lint && pnpm turbo build check-types test`.
- Terraform slices: fmt, validate and plan only; the owner applies.

### Track L: launch prerequisites (launch blocker; starts after the production-environment plan)

**L1 · Route 53 zone.** Depends on: domain purchase.

- Terraform `aws_route53_zone` (about $0.50/month). Output the name servers; set them at the registrar.
- Verify: plan summary; `dig NS <domain>` after delegation.
- Risks: delegation lag (allow 48 h). Keep the zone out of `destroy` paths.

**L2 · Stable origin hostname.** Depends on: L1.

- Elastic IP on the instance + an `origin.<domain>` A record. The CloudFront API origin becomes `origin.<domain>`.
- Remove the CLAUDE.md "re-apply after each start" rule.
- Cost: same as today's public IPv4 while running; billed while the instance is stopped.
- Verify: stop and start the instance → `/api/*` still works with no apply.

**L3 · Origin TLS + origin-verify header.** Depends on: L2.

Setup:

- Caddy container with the `caddy-dns/route53` plugin, built and pushed to ECR by Release. Pin the Caddy major and minor version.
- DNS-01 certificate for `origin.<domain>`. The instance role gets `route53:ChangeResourceRecordSets` on this zone only.
- Security group: 443 from the CloudFront origin-facing prefix list; port 80 removed.
- CloudFront origin `https-only`. The app publishes no host port; only Caddy publishes 443.
- The readiness check in `remote-deploy.sh` runs inside the container (`docker compose exec registration node -e "fetch('http://127.0.0.1:3001/health/ready')…"`).

Origin-verify header:

- CloudFront sends `X-Origin-Verify: <secret>`. The secret is in SSM; the Terraform var is sensitive.
- A Fastify `onRequest` hook refuses any request without a matching header (constant-time compare) with 403.
- **The only exception is by path, not by IP:** `GET`/`HEAD` on exactly `/health/live` and `/health/ready`, compared after query-string removal. These serve the container healthcheck and the deploy readiness check.
- Everything else needs the header, including other methods on those paths, `/health/live/x`, and encoded variants.
- Health responses carry no secrets or personal data, and CloudFront never routes `/health/*` to the origin.

How `X-Forwarded-For` flows (client sends `X-Forwarded-For: 6.6.6.6`):

1. **CloudFront** appends the viewer: `6.6.6.6, <viewer>`. It connects to Caddy from `<edge>`.
2. **Caddy `reverse_proxy`, by default,** treats `<edge>` as untrusted. It **discards** the incoming header and sends `XFF: <edge>`. Every viewer at that edge would look like one address, and the rate limit would collapse.
   - **Fix:** in the Caddyfile global options, `servers { trusted_proxies static 0.0.0.0/0 ::/0 }`. Caddy then keeps the incoming header and appends the peer: `6.6.6.6, <viewer>, <edge>`.
   - Trusting every peer at this layer is safe because the security group admits only CloudFront on 443, and the app refuses requests without the origin-verify header.
   - A static CloudFront CIDR list in Caddy was rejected: it duplicates the AWS-managed prefix list and goes stale.
3. **App:** the socket peer is Caddy. `TRUST_PROXY=2` (trust function `hop < 2`):
   - hop 0 = Caddy, trusted;
   - hop 1 = `<edge>`, trusted;
   - hop 2 = `<viewer>` → `req.ip`.

   `1` would give `<edge>` (collapsed rate limit); `3` would give `6.6.6.6` (spoofable). The CLAUDE.md TRUST_PROXY line is updated.

Tests:

- Header hook: missing or wrong header → 403 (mutation: skip the check).
- Health exception:
  - exact paths pass without the header;
  - `/health/live/x`, `POST /health/live`, `/health%2Flive` and `/api/...` are refused.
  - Mutations: a `startsWith('/health')` exception; an IP-based exception (`req.ip === '127.0.0.1'`), caught by a request sent via Caddy from a non-loopback address.
- **Real-Caddy integration test** (`test/caddy-proxy.int-spec.ts`):
  - testcontainers runs our built Caddy image with the same `deploy/Caddyfile`. The site address comes from an env placeholder, so the test serves plain HTTP; the proxy block is identical.
  - Caddy proxies to the in-process Nest app via the host gateway.
  - Requests carry `XFF: 6.6.6.<n>, 203.0.113.7`. Rotating `6.6.6.<n>` still hits 429; viewer `203.0.113.8` is counted separately.
  - Mutations: remove `trusted_proxies` → viewers collapse; `TRUST_PROXY: "1"`; `TRUST_PROXY: "3"`.

Verify on dev:

- Curl through CloudFront works.
- Direct `https://origin.<domain>` without the header → 403.
- Razorpay test webhook delivered.
- Real-network rate-limit check: exhaust the `start` limit from the laptop, then a phone on mobile data is still accepted.

Risks: certificate renewal failure (Caddy logs; covered by the monitoring plan); the SSM parameter-count check in `remote-deploy.sh`; Caddy default behaviour changing between versions (the real-Caddy test catches it).

**L4 · Viewer domain on CloudFront.** Depends on: L1 (parallel with L2/L3).

- ACM certificate in us-east-1 (free), alias record, `ADMIN_ORIGIN = https://<domain>`.
- Update the Razorpay webhook URL (owner).
- Verify: `https://<domain>` serves the site behind the gate; a webhook test passes.

### Track A: admin side

A1–A3 touch no infra and may start before Track L finishes.

**A1 · BIB helper refactor + rule.** Depends on: none.

- `allocateBib(client, eventId)`, used only by `confirmOnlinePayment`. No logic change.
- The approved CLAUDE.md rule wording.
- Test: static test that `next_bib` appears only in `payments.repository.ts` (mutation: reference it in another file).
- Verify: all existing payment and race tests unchanged and green.

**A2 · Test cleanup without DELETE.** Depends on: none.

- A shared `resetDatabase(pool)` in `test/support/database.ts` runs `TRUNCATE` on an explicit table list (`RESET_TABLES`) with `RESTART IDENTITY` and **no `CASCADE`**: a new table referencing a listed one makes the reset fail until it is added on purpose. Later slices extend the list (A3 added the admin and audit tables). It then resets the events row as the suites do today.
- Replaces the `DELETE FROM` lines in all 8 int/e2e suites.
- Why it holds up:
  - row-level `BEFORE DELETE` triggers do not fire on `TRUNCATE`;
  - each test file has its own container, and tests within a file run sequentially.
- What would break it: a `BEFORE TRUNCATE` trigger in production. None is planned: the app has no TRUNCATE path (enforced by the static test), and database-owner access can drop triggers anyway.
- Rejected: a template database per test. No concrete failure of the simple design was found.
- Tests:
  - static test: fails on `DELETE FROM (registrations|payments|kit_collections|audit_log|admin_users)` anywhere under `services/registration/{src,test}`, or `TRUNCATE` under `src/` (mutation: add such a line);
  - isolation test: a row created in one test is gone in the next (mutation: make `resetDatabase` a no-op);
  - the events seed row survives a reset (mutation: add `events` to the TRUNCATE).
- `CASCADE` was dropped during implementation, which removes the risk of it reaching further than intended. A test proves an unlisted referencing table makes the reset fail.

**A3 · Migration 006.** Depends on: A2.

- Section 4 as specified.
- Tests (mutation in brackets):
  - audit UPDATE/DELETE raises (drop trigger);
  - registration DELETE raises (drop trigger);
  - `admin_upi` rejected (keep old check);
  - duplicate receipt rejected (drop index);
  - BIB/DOB change on a confirmed row raises (drop guard);
  - `resetDatabase` still works with triggers installed;
  - the full existing suite stays green.
- Verify: migrate up/down/up in testcontainers.
- Risks: the `text` → `uuid` type change; the down migration; a trigger blocking a legitimate existing update (the existing suite covers it).

**A3b · Separate app database role.** Depends on: A3. Needed before: the first prod admin account (A5 run on prod).

- Today the app connects as `pawankhind`, the Docker image's superuser and the owner of every table, so it can disable the A3 triggers or truncate `audit_log`.
- A non-owner, non-superuser `pawankhind_app` login role: `SELECT`/`INSERT`/`UPDATE` where the app needs them, `INSERT` and `SELECT` only on `audit_log`, no `DELETE` or `TRUNCATE` anywhere. Migrations keep running as the owner.
- The role is created `NOLOGIN` in a migration; its password comes from a new SSM parameter (never in git) and is set by `remote-deploy.sh`. The app gets its own `DATABASE_URL`, and the migrate step gets the owner URL. The deploy's parameter-count check and `sed` lines change; the owner applies the SSM Terraform.
- Every later migration grants on its new tables. Tests: the e2e suite runs as the app role; that role's `UPDATE`/`DELETE`/`TRUNCATE` on `audit_log` and `ALTER TABLE … DISABLE TRIGGER` fail with `42501` (mutation: grant them).

**A4 · CloudFront admin gates + security headers.** Depends on: L3 (L4 optional).

- `admin-gate` on `/admin*` → S3. `api-admin-gate` on `/api/admin/*`, ordered before `/api/*` → API origin.
- `SecurityHeadersPolicy`. Update the CLAUDE.md go-live lines (admin gates stay).
- **Real-browser test, manual, in Chrome desktop and Safari on iPhone:**
  1. Open `/admin` and enter the gate credentials.
  2. In DevTools run `fetch('/api/admin/ping').then(r => [r.status, r.headers.get('www-authenticate')])`. Expect the app's response, not the gate's 401 with `WWW-Authenticate`, and no second prompt.
  3. In a private window with wrong credentials:
     - the same fetch gets the gate's 401;
     - `/` still asks for the gate;
     - `/api/registrations/x/status` needs no gate.
- Plus a curl sequence.
- Risks: cached Basic credentials are scoped by origin and realm (the same realm everywhere; the test proves it); behaviour precedence.
- **As built (dev, before L3):**
  - One gate function (`infra/edge/gate.js`, node tests) on all three gated behaviours instead of three functions: it never rewrites `/api/…`, which removes the reason for a separate API function, and the same code guarantees the same realm.
  - Path pattern `/api/admin*` (not `/api/admin/*`), so a bare `/api/admin` cannot fall through to the ungated `/api/*`.
  - The gate deletes `Authorization` on `/api/admin*` before forwarding, so the gate password never crosses the origin leg.
  - **Dev only, on the HTTP origin leg:** admin traffic between CloudFront and the instance is not encrypted until P8 (L3). Dev holds fake data and throwaway admin accounts only.
  - No CSP yet: a report-only CSP is proposed for a later slice, to be enforced only once it has been seen not to break the Razorpay checkout. `site_gate_enabled` stays with the prod slices.

**A5 · CLI user management + enrolment + TOTP.** Depends on: A3.

- CLI: `create`, `reset`, `disable`, `unlock`, `set-role`, all audited (`actor_kind = 'cli'`).
- Enrolment endpoints. Encrypted TOTP secret. `ADMIN_TOTP_KEY` in config and SSM (owner) + the `remote-deploy.sh` fix.
- Tests (mutation in brackets):
  - token reuse refused (skip the `used_at` check);
  - expired token refused (skip the expiry check);
  - the column holds ciphertext (store plaintext);
  - reset invalidates the old password and TOTP (skip clearing);
  - `create` refuses a second first admin.

**A6 · Login, sessions, CSRF, lockout.** Depends on: A5.

- Tests (mutation in brackets):
  - cookie flags (drop HttpOnly);
  - idle timeout per role (use the admin value for kit);
  - absolute expiry (drop the check);
  - the 5th failure locks even with the correct password (`>` vs `>=`);
  - TOTP replay refused (drop the step guard);
  - disabled user's session → 401 (skip the DB re-read);
  - foreign or missing `Origin` → 403 (skip the check);
  - logs contain no password, TOTP code or cookie (add a debug log).

**A7 · Permissions, default-deny guard, admin rate limits.** Depends on: A6.

- Tests (mutation in brackets):
  - every `/api/admin` route is `@Permission` or explicitly public (remove one decorator);
  - kit → 403 on admin-only routes (give kit the admin permissions);
  - the login rate limit applies (drop the rule).

**A8 · T-shirt totals endpoint.** Depends on: A7. Needed by: vendor deadline.

- Tests (mutation in brackets):
  - held not counted in the order figure (count held);
  - all six sizes present at 0 (drop the zero-fill);
  - kit may read (restrict to admin).

**A9 · Admin UI shell.** Depends on: A4, A8.

- Lazy routes, login, enrolment, role-aware navigation, logout, 401 → login. Home shows the T-shirt totals.
- Tests (mutation in brackets):
  - the landing bundle contains no admin code (build-output test; import admin eagerly);
  - kit sees no admin-only links;
  - the enrolment token is never sent in a URL.

**A10 · Paper + cash registration API.** Depends on: A1, A3, A7. Needed by: early Dec.

- Tests (mutation in brackets):
  - sold out → 409 (drop `slots_taken < capacity`);
  - outside the window → 403 (drop the window predicate);
  - **last-slot race, online hold vs paper entry, with a held-lock barrier → exactly one wins** (remove the guard);
  - duplicate person → 409, counters unchanged (catch and continue);
  - reused receipt → 409, no BIB or slot used (insert the payment after commit);
  - a body amount is ignored and the stored amount = fee (use the body value);
  - missing declaration → 400 (make it optional);
  - `entered_by`, `collected_by` and the audit row are present.
- Risk: lock order must match the existing order (payment → registration → event); the race test covers it.

**A11 · Paper entry UI.** Depends on: A9, A10. Needed by: early Dec.

- Tests (mutation in brackets):
  - exact "Signed paper form received" labels (change a label);
  - schema messages shown (copy a rule into the UI);
  - BIB comes only from the response (show a client value);
  - a double submit shows "receipt already used".

**A12 · Kit API + migration 007.** Depends on: A3, A7. Needed by: 15 Jan (target 8 Jan).

- Tests (mutation in brackets):
  - **concurrent double collect with a barrier → one 201, one 409 with who and when** (PK → plain index);
  - outside the window → 403 (drop the trigger);
  - the seed is exactly the two IST windows with no 17 Jan (alter the seed);
  - held/expired → 409 (drop the status check);
  - correction after collection → 409 locked (drop the lock clause);
  - partial mobile lookup refused (allow LIKE);
  - **`kit_proxy_consistent`:** accepts proxy + name + evidence, and self with both NULL. Rejects proxy without a name, proxy with a blank name, proxy without evidence, self with a name, and self with evidence. (Use the weaker CHECK `collected_by_proxy = (proxy_name IS NOT NULL AND proxy_evidence IS NOT NULL)`; "self with a name" is then accepted.)
  - The API schema is a discriminated union, so `{proxy:false, proxyName:"x"}` → 400 (make the fields optional on both branches).
- Risk: timezone in the seed (use explicit `+05:30`).

**A13 · Kit counter UI.** Depends on: A9, A12. Needed by: 15 Jan.

- Tests (mutation in brackets):
  - the button stays disabled until the ticks are done (drop the condition);
  - proxy fields are required for "someone else" (drop them);
  - the already-collected banner shows who and when;
  - the out-of-window banner shows the next window.
- Verify on a phone on the dev site, with the dev `kit_windows` moved around now (owner's SQL).

**A14 · Printed backup list.** Depends on: A9, A12. Needed by: 15 Jan.

- Tests (mutation in brackets):
  - kit → 403 (open it to kit);
  - an audit row is written (skip the audit);
  - collected rows are marked (drop the join).

**A15 · Cash reconciliation view.** Depends on: A9, A10. Needed by: the first bank deposit.

- Tests (mutation in brackets):
  - 23:30 IST lands on the right day (group by UTC);
  - total = sum of the stored amounts (sum a constant);
  - online payments excluded (drop the method filter);
  - kit → 403.

**A16 · Registration list + detail.** Depends on: A9.

- Tests (mutation in brackets):
  - list JSON never contains a full mobile (return raw);
  - `q="%"` doesn't match everything (drop escaping);
  - the detail view is audited (skip the audit).

**A17 · Corrections.** Depends on: A12, A16. Needed before BIB delivery.

- Tests (mutation in brackets):
  - name or mobile change without a reason → 400 (make the reason optional);
  - DOB is refused by the schema and the trigger (add DOB to the schema);
  - old/new values in the audit (omit them);
  - an index collision → 409;
  - collected → 409 locked.
- Risk: an "edit" that is really a transfer. Mitigated by the reason, the audit and the ID check at the kit counter.

**A18 · Exports (xlsx only).** Depends on: A16.

- `exceljs` streaming `WorkbookWriter`.
- Tests (mutation in brackets):
  - injected `=HYPERLINK(...)` (and `+ - @ \t \r`) is stored as text, checked by re-reading the file (drop the sanitiser);
  - the operations file has no DOB or emergency columns (add them);
  - kit → 403 on the full export;
  - 3000 seeded rows = DB count;
  - an audit failure means no file (audit after streaming).

**A19 · Audit viewer.** Depends on: A9.

- Tests (mutation in brackets):
  - kit → 403;
  - filters are applied server-side (filter in the UI only).

### Dependency overview

```
(production-environment plan) → L1 → L2 → L3          L1 → L4
A1, A2 → A3 → A5 → A6 → A7 → A8
A3 → A3b → (first prod admin account)
L3 → A4;   A4 + A8 → A9
A1 + A3 + A7 → A10 → A11
A3 + A7 → A12 → A13, A14
A9 + A10 → A15
A9 → A16 → A17 (+A12), A18
A9 → A19
```

## 11. Interim T-shirt totals (until A8)

Read-only, no personal data. The owner runs it:

```bash
AWS_PROFILE=pawankhind AWS_REGION=ap-southeast-2 aws ssm start-session \
  --target "$(terraform -chdir=infra/envs/dev output -raw instance_id)"
# in the session:
sudo -i
cd /opt/pawankhind
docker compose exec -T postgres psql -U pawankhind -d registration <<'SQL'
SELECT s.size                                          AS tshirt_size,
       count(r.id) FILTER (WHERE r.status = 'confirmed') AS confirmed,
       count(r.id) FILTER (WHERE r.status = 'held')      AS held_now
  FROM unnest(ARRAY['XS','S','M','L','XL','XXL']) WITH ORDINALITY AS s(size, ord)
  LEFT JOIN registrations r ON r.tshirt_size = s.size
 GROUP BY s.size, s.ord
 ORDER BY s.ord;
SELECT count(*) AS confirmed_total FROM registrations WHERE status = 'confirmed';
SQL
```

Order from `confirmed`. `held_now` are 10-minute online holds that may still convert.

## 12. Open items

- **T-shirt vendor deadline:** TBD (owner). Sets the A8/A9 date.
- **Domain:** TBD (owner choosing now). Blocks L1 and therefore the launch.

## 13. Next plans

1. **Next, before any Track L slice is implemented: production environment + backups + monitoring.**
   - Production vs dev environment layout.
   - Postgres backups and a tested restore.
   - Redis persistence.
   - Alerts: health, 5xx, certificate expiry, disk, `needs_support` payments.
   - Log retention.
   - Runbooks.

## 14. Out of scope

- **Forbidden by the event rules:** refunds, BIB transfer, race-day registration.
- **Not built now:**
  - WhatsApp/SMS BIB delivery (roadmap item 3);
  - admin-handled UPI;
  - passkeys;
  - recovery codes;
  - a users screen or invite flow;
  - the retention job;
  - an offline-capable app, and back-entry of collections after a window;
  - CSV export;
  - multi-event support.
