# Production environment plan

Status: approved 2026-10-29 (rev 2, with the review edits: hold cap 1000, fall-behind rules, legal wording in P3, reset script removed from prod after P14). Nothing implemented yet. Each slice is one PR on its own branch; Terraform slices are fmt/validate/plan only, and the owner applies.

This plan comes **before** Track L of `docs/plans/launch-and-admin.md` and absorbs it:

| Track L slice        | Becomes |
| -------------------- | ------- |
| L1 (zone)            | P1      |
| L4 (viewer domain)   | P2      |
| L2 (stable hostname) | P7      |
| L3 (origin TLS)      | P8      |

Admin slice A4 then targets dev and prod.

## 1. Context and decisions

**Dates:**

- Real participants register from **Sun 15 Nov 2026 00:00 IST**. The window closes 8 Jan 2027; kit days are 15–16 Jan; the race is 17 Jan.
- Prod runs continuously from about 12 Nov to 20 Jan. Dev is mostly stopped.
- Planning date: Thu 29 Oct 2026.

**Requirements:** no data loss, HTTPS end to end, Razorpay LIVE, a justified cost.

| Decision          | Choice                                                                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GitHub            | Private repo on the Free plan. Only the owner has write access, with 2FA on. No Environments or branch protection, so approval = manual dispatch + checks inside the workflow. |
| Database          | Postgres in Docker on a dedicated encrypted EBS volume, with 5-minute off-instance dumps. RDS rejected on cost (§3).                                                           |
| Live payment test | A genuine Rs 200 registration by an organiser before 15 Nov, with the window opened temporarily (§12).                                                                         |
| Public site       | Landing, legal pages and event contact are **public from Tue 3 Nov**, so Razorpay reviewers can check them. The server keeps registration closed until 15 Nov.                 |
| Go-live sign-off  | **Sat 14 Nov 10:00 IST**, before the freeze.                                                                                                                                   |
| Alerts            | Owner email + one organiser email. Addresses are set at apply time, not committed (personal data).                                                                             |
| Freeze            | Windows as in §7. Override allowed only with a written reason (for example a security fix).                                                                                    |
| Opening rush      | Assume **500 starts in the first 10 minutes**. The load test (≈ 10/s) covers it.                                                                                               |

**Facts from the code that shape this plan:**

- **Account-wide resources sit in the dev state.** The OIDC provider and the ECR repo are in `infra/envs/dev`, and ECR has `force_delete = true`. They stay there and are protected in place (P1); prod references them with data sources.
- **The CI role is trusted for any workflow on `main`**, so it could deploy prod.
- **`remote-deploy.sh` only appends `RAZORPAY_*` lines.** `POSTGRES_PASSWORD` was put in `.env` by hand.
- **Data and logs sit on the root disk.** Postgres and Redis use named volumes there. No log rotation. Redis has no `maxmemory`.
- **`config.ts` requires `rzp_test_`.**
- **Landing dates are static** (`src/event.ts`). CLAUDE.md already says to replace them with `GET /api/event`.
- **Razorpay payment IDs look the same in test and live** (`pay_…`), so the database can't tell them apart today.
- **`stress.int-spec.ts` proves the DB invariants under concurrency** (150 runners, 50 slots, in-process). It doesn't cover HTTP throughput, Caddy/CloudFront, Razorpay latency or t3 CPU.

## 2. Environment layout

```
infra/shared/       NEW, Route 53 zone only (state shared/terraform.tfstate, prevent_destroy)
infra/envs/dev/     unchanged layout; OIDC provider + ECR stay here, protected in place
infra/envs/prod/    NEW, a reviewed copy of dev (state envs/prod/terraform.tfstate);
                    data sources for the OIDC provider, ECR repo and Route 53 zone
```

| Item           | dev                                                               | prod                                                                                                                               |
| -------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| SSM            | `/pawankhind/dev/`                                                | `/pawankhind/prod/`. The instance role reads only its own path.                                                                    |
| Instance       | t3.small, stopped when idle                                       | t3.small, `credit_specification = unlimited`, termination protection, EC2 auto-recovery, AZ pinned                                 |
| Data           | named volumes on root                                             | encrypted gp3 10 GB volume at `/var/lib/pawankhind` (Postgres, Redis), `prevent_destroy`                                           |
| Origin         | `origin-dev.<domain>` → public IP, updated on each apply (no EIP) | `origin.<domain>` → Elastic IP                                                                                                     |
| Security group | 443 from the CloudFront origin-facing prefix list only            | same                                                                                                                               |
| Viewer         | CloudFront default domain (optional `dev.<domain>`)               | `<domain>` with ACM (us-east-1)                                                                                                    |
| Gates          | site + admin                                                      | **site gate off for public paths** from 3 Nov (variable `site_gate_enabled`, used only during the §12 test); admin gates always on |
| Razorpay       | test                                                              | test during rehearsal; live from 12 Nov                                                                                            |

**The dev/prod copy is reviewed by diff.** `infra/envs/prod/DELTAS.md` lists every intended difference from dev: names, SSM path, EIP, data volume, protections, data sources, viewer domain. The PR shows `diff -r infra/envs/dev infra/envs/prod`, and every hunk must map to a line in `DELTAS.md`.

**Rejected:**

- _Reusing dev as prod:_ dev has test keys, `?phase=` builds and experiments, and is stopped most of the time.
- _A separate AWS account:_ Organizations and cross-account ECR/OIDC take too long now. Post-event backlog.
- _Terraform workspaces:_ implicit state switching; explicit directories are easier to review.
- _A shared module, or moving OIDC/ECR to shared state, before launch:_ refactor risk on dev in the last 2 weeks. **After-event backlog.**

## 3. Database: Docker Postgres + backups

|                        | Docker + EBS + dumps (chosen)                                                                         | RDS db.t4g.micro single-AZ                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Extra cost             | about $1/month                                                                                        | about $20/month (≈ Rs 4,000 for the period) |
| Data loss window (RPO) | ≤ 5 min                                                                                               | ≈ 5 min                                     |
| Restore time (RTO)     | instance failure: about 10 min (auto-recovery, volume intact)<br>volume loss: ≤ 45 min (dump restore) | 20–30 min                                   |
| What we own            | dump timer, heartbeat alarm, restore runbook                                                          | little                                      |

- **Why it's acceptable:** the data is tiny (≤ 3000 rows), captured payments also exist at Razorpay, and the restore is drilled before launch.
- **Switch to RDS** if the drill misses 45 minutes.

## 4. Backups

- **Dumps every 5 min:**
  - a host systemd timer pipes `pg_dump -Fc` straight to S3 (no local file holding personal data);
  - `pipefail` plus a minimum-size check;
  - on success, a CloudWatch heartbeat metric.
- **Bucket `pawankhind-prod-backups-<acct>`:**
  - versioning, SSE-S3, TLS-only bucket policy, Block Public Access;
  - **Object Lock in governance mode, 3 days**;
  - the instance role gets `s3:PutObject`, plus `s3:ListBucket` on its own prefixes (to confirm a dump exists). No Get or Delete.
  - Retention by prefix:

    | Prefix                          | Kept              |
    | ------------------------------- | ----------------- |
    | `frequent/`                     | 3 days            |
    | `hourly/`                       | 30 days           |
    | `daily/`                        | until 17 Apr 2027 |
    | `predeploy/<sha>/`, `prereset/` | 30 days           |

- **EBS snapshots:** daily, via Data Lifecycle Manager, kept 7 days.
- **Restore runbook** (`docs/runbooks/restore.md`, P10). The owner runs it once before launch, timed, target ≤ 45 min:
  1. Fetch the dump.
  2. `pg_restore` into an empty Postgres on dev.
  3. Run the invariant SQL (counts only):
     - `slots_taken = held + confirmed`;
     - `next_bib − first_bib = confirmed`;
     - BIBs unique;
     - no confirmed registration without a captured payment.
  4. Compare row counts with prod.

  It also covers instance loss (a new instance + reattach the volume or a snapshot) and volume loss (dump restore).

- **In plain words:**
  - If the server and its disk are both lost, at most the last 5 minutes of registrations are lost. Payments from those minutes are still in Razorpay and are re-entered by hand.
  - Recovery takes about 10 minutes for an instance failure, and at most about 45 minutes for a full rebuild.

## 5. Redis

- **Persistence:** AOF `everysec` on the data volume. A restart loses at most about 1 second; rate-limit counters and admin sessions survive.
- **AOF lost:** limits reset (harmless, they fail open) and admins log in again.
- **Redis down:**
  - registration continues (rate limiting fails open);
  - admin login fails closed;
  - `/health/ready` reports it, so an alarm fires.
- **Memory:** `maxmemory 128mb`, `volatile-ttl`. Every key has a TTL.
- **No backups:** Redis data is disposable.

## 6. Razorpay LIVE

**Config (P4):**

- Required `APP_ENV` (`dev|prod`) and `RAZORPAY_MODE` (`test|live`), with no defaults.
- The key prefix must match the mode.
- **`live` only with `APP_ENV=prod`.**
- Errors list field names only. The startup log says `razorpay mode: …`, never the key.
- Update the CLAUDE.md "test keys only" rule to say this.

**Payment mode recorded (P4):**

- Additive migration: `payments.provider_mode text NOT NULL DEFAULT 'test' CHECK (provider_mode IN ('test','live'))`, stamped from config whenever the server creates a payment.
- The reset guard (§9) relies on it.

**Live marker (P4):** the first app start with `RAZORPAY_MODE=live` writes `live_activated_at` to a one-row `environment_state` table (additive migration). The owner also creates SSM `/pawankhind/prod/LIVE_ACTIVATED` during the live switch.

**Secrets:**

- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `POSTGRES_PASSWORD` and `RAZORPAY_MODE` live under `/pawankhind/prod/`.
- **The owner creates them** (CLI or console), so they never enter Terraform state.
- `remote-deploy.sh` rebuilds `.env` **entirely** from SSM on every deploy and checks that the required names are present (P5).

**Webhook:** live mode → `https://<domain>/api/webhooks/razorpay`, events `payment.captured` and `order.paid`, with a new random secret.

**KYC:**

- Apply **30 Oct**; it must be active by **10 Nov**. **This is a launch blocker:** if it's late, opening is delayed.
- Reviewers get the **public** URL from 3 Nov (P2 + P3): landing, Terms, Privacy, Refund, contact and the fee are visible.

## 7. Deployment safety

**`deploy-prod.yaml`:**

- `workflow_dispatch` only, from `main`. Inputs: the full `sha`, `confirm = deploy-prod`, optional `override_freeze` + `reason`.
- Steps:
  1. **Checks:**
     - the SHA is an ancestor of `main`;
     - CI succeeded for that SHA;
     - Release (dev) succeeded for that SHA;
     - the image exists in ECR.
  2. **Freeze check** against `deploy/freeze-windows.json`. An override is allowed only with a reason, which is printed to the log.
  3. **Promote:** retag the same digest as `prod-<date>-<sha7>` (no rebuild).
  4. **Backup:** a `predeploy/<sha>/` dump, verified.
  5. **Deploy:** migrate, deploy, readiness check.
  6. **Web:** prod web build, which fails if `VITE_ALLOW_PHASE_OVERRIDE` is set. Upload and invalidate.

**OIDC:**

- The owner sets the repo's subject template (`repo`, `context`, `job_workflow_ref`). The decoded `sub` is verified by printing the claim, never the token.
- The dev role is then trusted only for `release.yaml@refs/heads/main`.
- The new prod role `pawankhind-github-deploy-prod` (defined in `envs/prod`, trusting the provider by data source) is trusted only for `deploy-prod.yaml@refs/heads/main`. Its permissions:
  - `ssm:SendCommand` on the prod instance;
  - ECR describe/get/retag on the repo;
  - prod web bucket put/delete;
  - prod distribution invalidation.
- **Both trusts change in one PR**, because the template change breaks the old dev trust.

**ECR lifecycle:** keep the last 20 `prod-*` images; others, the last 10.

**Migrations:** additive and backward-compatible only during the registration window. Rollback = redeploy the previous `prod-*` SHA; the pre-deploy dump is the fallback. Destructive changes only after 20 Jan (to be written into CLAUDE.md).

**Freeze windows (IST):**

- **14 Nov 12:00 → 16 Nov 12:00**;
- **7 Jan 18:00 → 9 Jan 12:00**;
- **14 Jan 12:00 → 18 Jan 12:00**.

Other deploys: weekdays 10:00–17:00 IST. A deploy restarts the app for a few seconds; `/verify` callers fall back to status polling, and Razorpay retries webhooks.

## 8. Monitoring and alerts (email, Rs 0, ≤ 10 alarms account-wide)

| #   | Alarm                  | Source                                                                                                                                          | Fires when                                               |
| --- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1   | End-to-end health      | Lambda prober (free tier) every minute → `GET https://<domain>/api/health` (public liveness route, with a RateLimit rule)                       | 3 failures in a row, or no data                          |
| 2   | 5xx rate               | CloudFront `5xxErrorRate` (us-east-1)                                                                                                           | > 5 % for 5 min                                          |
| 3   | Instance status        | `StatusCheckFailed`; the system check also triggers auto-recover                                                                                | any failure                                              |
| 4   | Disk                   | CloudWatch agent, data volume + root                                                                                                            | > 80 %                                                   |
| 5   | Memory                 | CloudWatch agent                                                                                                                                | > 90 % for 10 min                                        |
| 6   | Backup heartbeat       | dump timer                                                                                                                                      | no successful dump for 20 min (missing data = breaching) |
| 7   | Paid but not fulfilled | ops timer every 5 min: count of captured payments without a confirmed registration, plus extra captured payments on confirmed ones (count only) | > 0                                                      |
| 8   | Origin cert expiry     | ops timer, `openssl` on Caddy's cert                                                                                                            | < 14 days                                                |
| 9   | Viewer cert expiry     | ACM `DaysToExpiry` (us-east-1)                                                                                                                  | < 30 days                                                |

- **Delivery:** SNS email topics in ap-southeast-2 and us-east-1, sent to the owner and one organiser.
- **Cost guard:** AWS Budgets at $35/month, with an email at 80 %.
- **Logs:** app logs go to CloudWatch Logs through the `awslogs` driver, kept 30 days. Session Manager sessions are logged for 30 days.
- **Every alarm is forced to fire once** before launch.

## 9. Pre-launch prod DB reset (script with guards, P12)

`deploy/ops/reset-prod-db.sh`, run by the owner in an SSM session. It is used only after the load test, before the live switch.

**It refuses, with a message that names the failed guard, unless all of these hold:**

1. `RAZORPAY_MODE=test` both in the running container's environment **and** in SSM `/pawankhind/prod/RAZORPAY_MODE`.
2. SSM `/pawankhind/prod/LIVE_ACTIVATED` does **not** exist.
3. `environment_state.live_activated_at` is NULL.
4. `SELECT count(*) FROM payments WHERE provider_mode = 'live'` = 0.
5. A **fresh** on-demand dump exists: the script writes `prereset/<timestamp>.dump`, then confirms it with `s3api list-objects-v2` (size above the minimum, less than 5 minutes old).
6. A typed confirmation matches: `RESET <instance-id> <registrations-count>`.

**Then it:**

1. stops the app container;
2. runs `DROP DATABASE registration` and `CREATE DATABASE registration` (no row deletes; the no-delete rule is about app code paths);
3. runs the migrations, which recreate the seed event row;
4. starts the app.

**It prints only counts:** registrations, payments, `slots_taken`, `next_bib`, before and after.

**After live mode is on**, guards 2 and 3 make it permanently unusable, and guard 4 stays as a backstop.

**After the P14 reset, the script leaves prod (P14b).** It is removed from the prod deploy bundle, and the deploy deletes any copy on the instance, so it can't be run later. The guards remain as a second layer, in case a copy ever reappears. Dev keeps the script for tests.

**Tests** (a Node test runs the script against a testcontainers Postgres, with a stubbed `aws` CLI on `PATH`). One case per guard, each with a mutation that removes the guard and turns the case red:

- live mode;
- SSM marker present;
- DB marker set;
- a live payment row;
- missing dump;
- stale dump;
- wrong confirmation.

A happy-path case checks the counts afterwards (`0/0`, `slots_taken = 0`, `next_bib = 1001`).

## 10. Capacity and load test

- **Load:** 3000 registrations in total. The opening rush is assumed at 500 starts in 10 minutes (under 1/s on average, with bursts).
- **Hardware:** t3.small (2 vCPU burst, 2 GB) with `unlimited` credits is ample. Razorpay latency is the real limit.
- **Load test (P14),** with k6 against **prod in test mode**:
  - 500 `POST /api/registrations` ramped to about 10/s over 2 minutes, plus 20/s status polls for 5 minutes;
  - `RATE_LIMIT_SCALE` (accepted only when `RAZORPAY_MODE=test`; P4) gets past the per-IP limits, and is removed afterwards;
  - pass criteria: start p95 < 1.5 s; status p95 < 300 ms; 0 × 5xx; CPU < 70 %; memory < 75 %; invariants hold;
  - payment completion isn't automated; the stress test covers the confirm path.
- **Then** the §9 reset.

## 11. Data protection

- **At rest:** encrypted EBS and snapshots, SSE-S3, SecureString.
- **In transit:**
  - viewer TLS 1.2+;
  - CloudFront → origin HTTPS with an origin-verify header;
  - TLS-only bucket policies;
  - app ↔ Postgres/Redis on the same host's Docker network.
- **Access:** SSM Session Manager only. No SSH key, no port 22, no Tailscale in prod. IMDSv2. The owner is the only AWS user (MFA on root and the IAM user). Organisers use only the admin UI.
- **Logs:** never personal data, secrets, signatures or request bodies. Runbook SQL prints counts.
- **Retention:**
  - anonymise on **17 Apr 2027** (separate plan; legal review);
  - backup lifecycles end by then;
  - snapshots deleted after 20 Jan;
  - prod destroyed after the final dump, except the backup bucket.

## 12. Live payment test with a public site (P15, Thu 12 Nov)

From 3 Nov the landing page is public. Once P6 is in, the landing follows `GET /api/event`, so **while the test window is open the public would see the form**. The test therefore re-gates the site for its duration.

**0. Preconditions:**

- Load test done and the DB reset (§9). **P14b deployed:** the reset script is gone from prod.
- KYC active. Live secrets in SSM, `RAZORPAY_MODE=live`, deployed; the log shows `razorpay mode: live`.
- `LIVE_ACTIVATED` created.
- Live webhook configured. Backups and alarms green.

**1. Re-gate:**

- `terraform apply` with `site_gate_enabled = true` (prod).
- Wait for propagation.
- Verify: `curl -s -o /dev/null -w '%{http_code}' https://<domain>/` → **401**.

**2. Backup + baseline (counts only):**

- Take an on-demand dump.
- `SELECT reg_opens_at, reg_closes_at, capacity, first_bib, next_bib, slots_taken FROM events;`
- Expect `2026-11-15 00:00+05:30`, `2027-01-08 23:59:59+05:30`, `3000`, `1001`, `1001`, `0`.
- `count(registrations) = 0`.

**3. Open the window.** Keep it short (≤ 20 minutes); `/api` itself is not gated.

```sql
BEGIN;
UPDATE events SET reg_opens_at = now() - interval '1 minute'
 WHERE name = 'Pawankhind Season-3' AND reg_opens_at = '2026-11-15 00:00:00+05:30'
RETURNING reg_opens_at, reg_closes_at;   -- exactly 1 row, else ROLLBACK
COMMIT;
```

**4. Register and pay.** The organiser registers on `https://<domain>/` with the gate credentials and pays **Rs 200 for real**.

**5. Checks:**

- The result page shows confirmed + **BIB 1001** (from the server).
- DB:
  - registration confirmed, `online`, BIB 1001;
  - payment `razorpay`, `captured`, `20000`, `provider_mode = 'live'`;
  - `slots_taken = 1`, `next_bib = 1002`.
- Razorpay: payment captured; webhook delivery 200.
- The next reconciliation tick (≤ 10 min) has nothing to fix. Alarm 7 = 0.

**6. Close the window:**

```sql
BEGIN;
UPDATE events SET reg_opens_at = '2026-11-15 00:00:00+05:30'
 WHERE name = 'Pawankhind Season-3' AND reg_opens_at < '2026-11-15 00:00:00+05:30'
RETURNING reg_opens_at, reg_closes_at;   -- 1 row; closes_at unchanged
COMMIT;
```

**7. Verify it's closed:**

- `POST /api/registrations` (valid body) → **403 `closed`**.
- `GET /api/event` → before.

**8. Invariants** (after any abandoned hold has expired, ≤ 10 min, so `held = 0`):

- `slots_taken = held + confirmed`;
- `next_bib − first_bib = confirmed`;
- `capacity = 3000`;
- `reg_closes_at` unchanged;
- the `(id, status, bib, created_at)` list shows only the expected rows.

Anyone else who registered and paid through the ungated API in the window is a genuine participant: keep them and note it.

**9. Un-gate:**

- `terraform apply` with `site_gate_enabled = false`.
- `curl` `/` → **200**; the landing shows "opens 15 Nov".

**10. Record** in the launch log.

## 13. Optional hardening: slot hoarding (P13, target Tue 10 Nov)

**Threat:** a bot starts registrations with fake identities. Each start holds a slot for 10 minutes without paying. Today one IP can hold 60 slots (`start` limit 60 per 10 min), so 50 IPs could block all 3000.

**Recommendation, the cheapest free control:** a cap on concurrent unpaid holds, inside the existing reserve transaction.

- `reserveSlot` refuses with `503 busy` + `Retry-After` when `count(held) ≥ HOLD_CAP`.
- **Default `HOLD_CAP = 1000`**, about a third of capacity.
- **Configurable through SSM** (`/pawankhind/<env>/HOLD_CAP`) with no code change. The deploy rebuilds `.env` from SSM, so re-running the deploy of the current SHA applies a new value. Config validates it as a positive integer ≤ capacity.
- **Tune it against the load test (P14).** At the assumed 500 starts in 10 minutes, genuine concurrent holds stay below 500, so 1000 leaves headroom. Record the peak `held` count seen and adjust before 14 Nov.
- The live-hold **resume** path runs before reserve, so real users returning to their own hold are unaffected.
- The cap is an abuse limit, not an invariant: concurrent starts may overshoot it slightly. Slot and BIB invariants are untouched.
- No third party, no cost.

**What it stops:** any number of bot IPs tying up more than 1000 slots at once, so capacity can never be exhausted by holds. It also bounds the damage to "busy, retry" for at most 10 minutes per wave.

**What it doesn't stop:**

- a distributed bot that keeps the cap full: real users see "busy" while it runs (availability degrades, capacity doesn't);
- people paying Rs 200 for fake entries (real money, real records);
- scraping the public pages.

**Escalation, if an attack is seen:** Cloudflare Turnstile (free). Its token is verified server-side before reserving. That adds a third-party script and request, so it needs a Privacy page update. **AWS WAF rejected:** about $5+/month.

**Tests** (mutation in brackets):

- cap reached → 503 `busy` (drop the check);
- own-hold resume still works at the cap (move the cap before resume);
- invariants hold under the stress test with a low cap.

## 14. Cost (approx., ap-southeast-2, USD; ₹ at about 85/$; verify in the AWS calculator)

| Item                                                                                     | Prod $/month                                                                                       |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| EC2 t3.small on-demand                                                                   | ~19.3                                                                                              |
| Elastic IP / public IPv4                                                                 | 3.65 (billed even while stopped)                                                                   |
| EBS gp3 20 GB root + 10 GB data                                                          | ~2.9                                                                                               |
| Snapshots, S3 backups + web                                                              | < 0.8                                                                                              |
| Route 53 zone                                                                            | 0.50                                                                                               |
| CloudFront (always-free tier), CloudWatch within free counts, Lambda, SNS email, Budgets | 0                                                                                                  |
| ECR                                                                                      | ~0.1                                                                                               |
| **Total**                                                                                | **≈ $27 ≈ Rs 2,300/month ≈ Rs 5,300 for 12 Nov–20 Jan**, plus the domain (about Rs 800–1,200/year) |

- **After the event:** final dumps, then destroy the prod instance, EIP and volumes. About $0.6/month remains.
- **No downsizing between 8 and 20 Jan:** admin and kit use continues, and a t3.micro has too little RAM.
- **t4g (ARM):** deferred; it needs arm64 builds.

## 15. Slices (one PR each; dates count back from Sun 15 Nov)

| #    | Slice                                                                                                                                                                                                                                                                                                                                             | Needed by                                   | Tests / verification                                                                                                                                                                                                                                                                                  | Risks                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| P0   | **Owner actions:** apply for Razorpay KYC; buy the domain; get an **event-only contact number and email**; **start the legal review** of Terms, Privacy, Refund and the cancellation/weather wording; **confirm the GitHub plan** (Free, private) and turn on **2FA**                                                                             | **Fri 30 Oct**                              | KYC submitted; domain registered; contact live; reviewer engaged; 2FA on                                                                                                                                                                                                                              | KYC and legal lead times                                                                 |
| P1   | **Route 53 zone** in `infra/shared` (`prevent_destroy`); in dev: ECR `force_delete = false`, `prevent_destroy` on the ECR repo and the OIDC provider                                                                                                                                                                                              | Mon 2 Nov                                   | Shared plan: 1 zone. Dev plan: only the in-place `force_delete` change. `dig NS <domain>` after delegation                                                                                                                                                                                            | Delegation lag                                                                           |
| P2   | **Prod web edge**, first part of the `envs/prod` copy: S3, CloudFront with `<domain>` + ACM, gate functions (`site_gate_enabled = false`, admin gates on), `DELTAS.md`. **No `/api` origin yet**                                                                                                                                                  | Tue 3 Nov                                   | Diff vs dev maps to `DELTAS.md`; `https://<domain>/` returns 200; `/admin` returns 401                                                                                                                                                                                                                | ACM DNS validation; an `/api` call before P7 hits S3 (none expected; the form is closed) |
| P3   | **Public content:** event-only contact; Terms/Privacy/Refund containing a **clear refund statement** (no refunds) and the **cancellation and bad-weather wording**, using the owner's draft lines (decided rules only); landing shows "Registration opens 15 Nov" (static phase until P6). The owner uploads this first build manually (until P9) | Tue 3 Nov                                   | Web tests: contact shown; legal links resolve; the refund, cancellation and bad-weather statements are present on the right pages (remove one → red); Razorpay reviewers get the URL                                                                                                                  | Needs the owner's draft lines by 2 Nov. Final legal pass is P16                          |
| P4   | **Config + markers:** `APP_ENV`, `RAZORPAY_MODE` rules; `RATE_LIMIT_SCALE` (test mode only); migrations for `payments.provider_mode` and `environment_state`                                                                                                                                                                                      | Wed 4 Nov                                   | Unit tests (mutation in brackets): dev+live refused (allow); prod+live with `rzp_test_` refused (skip the prefix check); missing `APP_ENV` refused (default it); scale refused in live (allow). e2e: a new payment carries the configured mode (hard-code test); live start sets the marker (skip it) | The owner adds the new dev SSM params before the deploy                                  |
| P5   | **Deploy/compose:** `.env` fully rebuilt from SSM with required names checked; data paths on `/var/lib/pawankhind`; `awslogs` + rotation; Redis `maxmemory`; host systemd units (backup, ops timers) installed idempotently                                                                                                                       | Wed 4 Nov                                   | Script test with fake SSM output: missing name → fail (drop the check); dev deploy green                                                                                                                                                                                                              | Moving dev data to the new path (test data only)                                         |
| P6   | **`GET /api/event` + `GET /api/health`** (both rate-limited); landing follows `/api/event` (static dates only as a loading fallback, never deciding "open")                                                                                                                                                                                       | Thu 5 Nov                                   | e2e: phase follows the event row (hard-code it). Web: form only when the API says open (use static dates). RateLimit rule present                                                                                                                                                                     | Prod web needs the `/api` origin (P7) before this landing build goes to prod             |
| P7   | **Prod instance**, second part of the copy: instance, data volume, EIP + `origin.<domain>` (L2), SG, IAM (`/pawankhind/prod` only), DLM, log group, `/api/*` behaviour; the owner creates prod SSM params                                                                                                                                         | Thu 5 Nov                                   | Diff vs dev maps to `DELTAS.md`; manual SSM deploy of the current SHA works; `/api/event` through CloudFront                                                                                                                                                                                          | AZ mismatch between instance and volume (pinned)                                         |
| P8   | **Origin TLS + verify header (L3)**, dev then prod (Caddy DNS-01, `trusted_proxies`, `TRUST_PROXY = 2`, health-path-only exception), as in `launch-and-admin.md`                                                                                                                                                                                  | Sat 7 Nov                                   | Real-Caddy integration test + mutations; direct origin → 403; webhook delivered                                                                                                                                                                                                                       | Certificate issuance; Route 53 IAM                                                       |
| P9   | **`deploy-prod.yaml`** + OIDC subject template + both role trusts + freeze file + retag + pre-deploy dump                                                                                                                                                                                                                                         | Sun 8 Nov                                   | Decoded `sub` verified; dispatch from a branch refused; unknown SHA refused; a temporary freeze window refuses; override with a reason passes; dev Release still green                                                                                                                                | Dev deploy breaks if only one trust is updated (same PR)                                 |
| P10  | **Backups + restore runbook**                                                                                                                                                                                                                                                                                                                     | Mon 9 Nov; **drill by Tue 10 Nov**          | Heartbeat visible; Object Lock blocks a delete; drill timed ≤ 45 min with invariants passing                                                                                                                                                                                                          | `pipefail` mistakes; an over-strict bucket policy                                        |
| P11  | **Monitoring + alerts** (§8) + Budgets                                                                                                                                                                                                                                                                                                            | Tue 10 Nov; each alarm forced by Wed 11 Nov | An email received for each of the 9 alarms                                                                                                                                                                                                                                                            | Free-tier counts                                                                         |
| P12  | **Reset script with guards** (§9)                                                                                                                                                                                                                                                                                                                 | Tue 10 Nov                                  | One test per guard, each with its mutation; happy path checks the counts                                                                                                                                                                                                                              | Script run in the wrong environment (guards 1–4 block it)                                |
| P13  | _(optional)_ **Hold cap** (§13), default 1000, SSM-configurable                                                                                                                                                                                                                                                                                   | Tue 10 Nov                                  | §13 tests, plus: a cap read from config, an invalid value refused (hard-code it → red)                                                                                                                                                                                                                | A wrong cap for the real rush. Tune it from the P14 peak `held` count                    |
| P14  | **Load test** (prod, test mode), then **reset**; record the peak `held` count for `HOLD_CAP`                                                                                                                                                                                                                                                      | Wed 11 Nov                                  | §10 criteria recorded; reset counts printed                                                                                                                                                                                                                                                           | Razorpay test rate limits (≤ 10/s)                                                       |
| P14b | **Remove the reset script from the prod deploy path** (§9): drop it from the prod deploy bundle, and the deploy deletes any copy left on the instance                                                                                                                                                                                             | Thu 12 Nov, **before P15**                  | Deploy-bundle check: a prod bundle containing `reset-prod-db.sh` fails the workflow (add it back → red); after the prod deploy, the file is absent on the instance                                                                                                                                    | Forgetting it before the live switch (P15 precondition)                                  |
| P15  | **Live switch + live payment test** (§12, procedure)                                                                                                                                                                                                                                                                                              | Thu 12 Nov                                  | All §12 checks recorded                                                                                                                                                                                                                                                                               | KYC not active → **opening delayed**                                                     |
| P16  | **Final legal pass:** wording from the review across Terms, Privacy, Refund, cancellation and bad weather + CLAUDE.md "Before go-live" ticked                                                                                                                                                                                                     | Fri 13 Nov                                  | Web tests; checklist                                                                                                                                                                                                                                                                                  | Review late → keep the P3 wording (decided rules only)                                   |
| —    | **Go-live sign-off**, Sat 14 Nov 10:00 IST                                                                                                                                                                                                                                                                                                        | —                                           | §16 D−1 checks                                                                                                                                                                                                                                                                                        | —                                                                                        |

**Freeze from Sat 14 Nov 12:00 IST.** Admin slices A1–A3 can continue on dev.

### If we fall behind

- **Cut order** (first to last):
  1. **P13** (hold cap): optional; the per-IP limit stays.
  2. **P11 reduced** to alarms **1** (end-to-end health), **3** (instance status), **6** (backup heartbeat) and **7** (paid but not fulfilled). The others follow after launch.
  3. **A smaller load test (P14):** for example 200 starts at about 5/s, same pass criteria.
- **Never cut:**
  - **P8** (origin TLS + verify header);
  - **P10** (backups + timed restore drill);
  - **P15** (live switch + live payment test).
- **Check-in on Thu 5 Nov:** if P2–P5 are not done, **opening is delayed** (announce a new date). Safety slices are not dropped to keep 15 Nov.

## 16. Launch-week runbook skeleton (`docs/runbooks/launch-week.md`, written with P15)

| When                                                           | Action                                                                                                                                                                              |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tue 10 Nov (D−5)**                                           | Restore drill done. OS updates applied and rebooted; after this, security fixes only (freeze override with a reason)                                                                |
| **Wed 11 Nov (D−4)**                                           | Alarms forced; load test; reset (§9)                                                                                                                                                |
| **Thu 12 Nov (D−3)**                                           | Live switch; live payment test (§12)                                                                                                                                                |
| **Fri 13 Nov (D−2)**                                           | Final legal wording; last planned prod deploy                                                                                                                                       |
| **Sat 14 Nov 10:00 (D−1)**                                     | Go-live sign-off: public landing OK; `POST /api/registrations` → 403 `closed`; `razorpay mode: live`; alarms green; backups heartbeating; contact number answered. **Freeze 12:00** |
| **Sat 14 Nov 23:45 → Sun 15 Nov 01:00 (D0, opening at 00:00)** | Watch alarms, CloudFront 5xx and the Razorpay dashboard. First real BIBs. Invariants SQL (counts). Incidents follow the restore/rollback runbooks; contact tree                     |
| **Sun 15 Nov morning**                                         | Invariants; alarm 7 = 0; backups present                                                                                                                                            |
| **Mon 16 Nov (D+1)**                                           | Freeze ends at 12:00. Retrospective. T-shirt interim query                                                                                                                          |

## 17. Open questions

- **Alert addresses:** the owner provides them at P11 apply time (not committed).

## 18. After-event backlog

- shared Terraform module for dev/prod;
- moving OIDC/ECR to shared state;
- a separate prod AWS account;
- t4g/ARM;
- Turnstile, if bots were seen;
- the retention/anonymisation job (17 Apr 2027).
