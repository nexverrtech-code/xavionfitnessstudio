# SmartGym

A cloud gym management system that runs entirely on Cloudflare's **free plan**:

- **Staff app:** members, membership plans and memberships, payments (cash, UPI, bank transfer, card on the gym's own terminal), QR attendance, trainers, workout plans, progress, in-app notifications, expenses, reports and **Data & Backup**.
- **Member app:** an installable PWA with the member's membership, QR pass, UPI renewals, attendance, workout, progress, payments and receipts.

| Layer | Technology |
|---|---|
| Frontend | React 19 · Vite 8 · TypeScript · Tailwind CSS 4 · React Router 7 · Axios · React Hook Form + Zod · Recharts · Lucide — on **Cloudflare Pages** |
| Backend | Python 3.13 · FastAPI inside a **Cloudflare Python Worker** (no Uvicorn in production) |
| Database | **Cloudflare D1** (SQLite), bound as `DB` |
| Jobs | One Cron Trigger: daily at 06:00 IST |

```
 Browser / installed PWA ──HTTPS JSON /api/*──▶ Python Worker (FastAPI) ──prepared statements──▶ D1
 (Cloudflare Pages)                               └─ cron (daily): statuses, reminders, clean-up, storage snapshot
```

There are **no external services**: no payment gateway, no SMS / WhatsApp / e-mail provider, no R2, no other database. The database stores only IDs, short text, dates, integer amounts and statuses: no photos, files, PDFs or blobs. Receipts, reports and backups are built **in the browser** from JSON the API returns and saved on the admin's device.

---

## Contents

1. [Roles](#roles)
2. [Repository layout](#repository-layout)
3. [Run it locally](#run-it-locally)
4. [Tests and checks](#tests-and-checks)
5. [Deploy to Cloudflare](#deploy-to-cloudflare)
6. [Configuration reference](#configuration-reference)
7. [Payments and memberships](#payments-and-memberships)
8. [Attendance](#attendance)
9. [Notifications](#notifications)
10. [Reports and receipts](#reports-and-receipts)
11. [Data & Backup](#data--backup)
12. [Data model](#data-model)
13. [Free plan: performance and D1 usage](#free-plan-performance-and-d1-usage)
14. [Security](#security)
15. [PWA and offline behaviour](#pwa-and-offline-behaviour)
16. [Design decisions and deviations](#design-decisions-and-deviations)
17. [Known limitations](#known-limitations)

---

## Roles

Permissions are enforced by the API on every request; the UI only hides what a role can't use.

| Role | Can do |
|---|---|
| **ADMIN** | Everything: plans, trainers, team accounts, settings, expenses, all reports, refunds, notifications, **Data & Backup** (backups, archive, restore, D1 Time Travel) |
| **STAFF** (front desk) | Members, memberships, payments (record, approve, reject), attendance and basic reports (not the expense report) |
| **TRAINER** | Only *assigned* members: workout plans, measurements / progress, attendance. No finance data |
| **MEMBER** | Only their own data through `/api/me/*`. The member ID always comes from the token, never from the client |

Sidebar order (admin): Dashboard, Members, Membership Plans, Memberships, Payments, Attendance, Trainers, Workout Plans, Progress, Notifications, Expenses, Reports, Data & Backup, Settings.

### Member app access

A member **can't open the member app until staff give them access**. Everything about the login lives in one dialog, **Member app access**: open it from the member's page (*Give / Manage app access* on the Overview, or **More → Member app access**) or from **Edit member**.

| State | Meaning |
|---|---|
| Not set up | No login yet; sign-in attempts are refused |
| Waiting for first sign-in | Login given; the member still has to choose their own password |
| Active | In use (shows the last sign-in) |
| Turned off | Signed out everywhere and refused until access is given again; membership, payments and history are kept |

Giving access (or setting a new password) offers two ways:
- **One-time password** (recommended): generated, shown once, and the member must choose their own at first sign-in.
- **Type a password**: staff choose it (same strength rules as everywhere) and decide whether the member must change it at first sign-in.

The result shows the app address, the login (member ID — the member's phone number or email also work) and, for one-time passwords, the password, plus a *Copy message to send* button. A new password signs the member out on every device. *Give member app access now* on the Add member form does the same at registration. API: `POST /api/members/{id}/app-access` with an optional body `{"password": "...", "must_change_password": true}`; `DELETE` turns access off.

---

## Repository layout

```
backend/                       Cloudflare Python Worker
  src/main.py                  Worker entry: fetch → FastAPI, scheduled → jobs.scheduler
  src/app.py                   App factory, /api prefix, CORS, security headers, Server-Timing, body limit
  src/api/                     Routers (/api/auth, users, settings, members, membership-plans, memberships,
                               payments, attendance, trainers, workouts, progress, notifications, expenses,
                               reports, dashboard, backups, storage, me)
  src/services/                Business logic (MemberService, PaymentService, BackupService …) — no SQL
  src/repositories/            All SQL, one repository per domain, always bound parameters
  src/schemas/                 Pydantic request models (unknown fields rejected)
  src/models/                  Domain constants and the signed-in user
  src/core/                    Config, clock, errors, cache; database/ (D1 adapter + SQLite adapter for tests)
  src/security/                Password hashing (PBKDF2 + pepper), JWTs, opaque QR tokens, login rate limit
  src/backup/datasets.py       What a backup contains and how each table is exported, archived and restored
  src/jobs/scheduler.py        The daily cron job ("jobs", because "workers" is the Cloudflare SDK module)
  src/utils/                   Formatting, UPI links, HTTP helpers, Cloudflare API (Time Travel)
  migrations/0001–0006         Core, payments, operations, data management, indexes, integrity triggers
  scripts/                     seed_dev.py · dev_server.py · create_admin.py · smoke_test.py
  tests/                       pytest suite (69 tests)
  wrangler.jsonc               D1 binding, cron, rate limiter, public vars

frontend/                      React PWA for Cloudflare Pages
  src/pages/                   Staff screens, backup/ (Data & Backup), portal/ (member app)
  src/components/              UI kit, dialogs, charts, QR encoder/scanner, backup panels
  src/services/                api.ts (Axios) · endpoints.ts (one function per route) ·
                               documents.ts (receipt/report PDF + CSV) · backup.ts (ZIP build / read)
  src/utils/                   zip.ts (store-only ZIP + CRC-32 + SHA-256) · pdf.ts (PDF writer) · csv.ts
  src/hooks/useApi.ts          Small cached data hook (shared requests, freshness window)
  src/sw/sw.template.js        Service worker (emitted as /sw.js at build time)
  vite.config.ts               Also emits sw.js and Cloudflare Pages _headers (CSP, caching)
```

---

## Run it locally

**Prerequisites:** Node.js 20.19+ or 22.12+, [uv](https://docs.astral.sh/uv/) (it installs Python 3.13 for you), and Git. Wrangler runs through `npx`.

### 1. Backend on the real Workers runtime (recommended)

```bash
cd backend
cp .dev.vars.example .dev.vars          # local-only secrets, git-ignored
uv sync                                 # dev tools: pywrangler, pytest …
npx wrangler d1 migrations apply smartgym-db --local
npx wrangler d1 execute smartgym-db --local --file=seed/dev_seed.sql   # demo data (optional)
uv run pywrangler dev                   # http://127.0.0.1:8787/api/health
```

`pywrangler dev` runs the Worker in `workerd` with a local D1 database stored in `backend/.wrangler/`. The seed is dated relative to the day it's generated and its password hashes use the `AUTH_SECRET` pepper from `.dev.vars`; regenerate it with `uv run python scripts/seed_dev.py > seed/dev_seed.sql`.

<details>
<summary><b>Windows notes</b></summary>

- If uv fails to install Python with a "Missing expected target directory" or link error, keep uv's folders on the same drive as the project:
  `set UV_PYTHON_INSTALL_DIR=%CD%\.uv\python` and `set UV_CACHE_DIR=%CD%\.uv\cache` (both git-ignored).
- `pywrangler` must be able to find `uv` on `PATH`.
</details>

A CPython + SQLite server for quick UI work also exists: `uv run python scripts/dev_server.py --reset --seed` (same app, port 8787). Use `pywrangler dev` to test real Workers/D1 behaviour.

### 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env.local              # VITE_API_URL empty = same origin
npm run dev                             # http://localhost:5173 — Vite forwards /api/* to :8787
```

### Demo logins (development seed only)

| Role | Sign in with | Password |
|---|---|---|
| Admin | `admin@smartgym.local` | `Admin@123` |
| Staff | `desk@smartgym.local` | `Desk@1234` |
| Trainer | `trainer1@smartgym.local` | `Coach@1234` |
| Member | `GYM000001` | `Member@123` |

> The seed creates **fake** people, payments and well-known passwords. Never load it into production.

---

## Tests and checks

```bash
cd backend  && uv run pytest                  # 69 tests: auth, members, app access, payments, memberships, attendance,
                                              # permissions, notifications, reports, backups, storage
cd frontend && npm run build                  # strict type-check + production build (emits sw.js and _headers)

# End-to-end workflow + latency check against a running API (local, with the dev seed):
cd backend && uv run python scripts/smoke_test.py --base http://127.0.0.1:8787
```

The smoke test signs in as every role and exercises members, desk payments (with an idempotent replay), UPI approval, QR scans and duplicate-scan protection, reports, receipts, backups, storage and the member app. It prints each call's latency and the D1 statistics from the `Server-Timing` header (`N trips, N stmts, N rows read, N rows written`).

---

## Deploy to Cloudflare

Replace `gymname.com` with your domain (the zone must be on Cloudflare for custom domains).

### 1. Database

```bash
cd backend
npx wrangler login
npx wrangler d1 create smartgym-db                 # copy the printed database_id into wrangler.jsonc
npx wrangler d1 migrations apply smartgym-db --remote
```

### 2. Worker settings and secrets

In `backend/wrangler.jsonc`, set `ALLOWED_ORIGINS` to your frontend origin(s). Then add the secrets (never in `vars`, never in the frontend, never in Git):

```bash
npx wrangler secret put JWT_SECRET      # required: 32+ random characters, e.g. `openssl rand -base64 48`
npx wrangler secret put AUTH_SECRET     # required: 32+ random characters (password pepper)
```

The Worker refuses to start in production with a missing or weak `JWT_SECRET`/`AUTH_SECRET`, or with a `*` CORS origin. Keep `AUTH_SECRET` stable: changing it invalidates every password.

### 3. Deploy the API

```bash
uv run pywrangler deploy
```

Choose **one** way to serve it:

- **Same origin (recommended).** Add a Worker route: `"routes": [{ "pattern": "gymname.com/api/*", "zone_name": "gymname.com" }]` and build the frontend with `VITE_API_URL` empty. No CORS preflights. Check `https://gymname.com/api/health`.
- **API subdomain.** `"routes": [{ "pattern": "api.gymname.com", "custom_domain": true }]` and `VITE_API_URL=https://api.gymname.com`.

### 4. Create the first admin

- **Script (recommended):**
  ```bash
  uv run python scripts/create_admin.py --email owner@gymname.com --name "Gym Owner" > admin.sql   # prompts for the password and AUTH_SECRET
  npx wrangler d1 execute smartgym-db --remote --file=admin.sql
  rm admin.sql
  ```
- **One-time setup page:** set a `SETUP_TOKEN` secret and open `https://gymname.com/setup`. It works only while no admin exists. Delete the secret afterwards.

### 5. Deploy the frontend (Cloudflare Pages)

- Git integration: root `frontend`, build `npm run build`, output `dist`, variable `VITE_API_URL` (empty or the API origin).
- Or: `cd frontend && npm run build && npx wrangler pages deploy dist --project-name smartgym`

The build generates `_headers` with the CSP (including your API origin when it's separate), security headers and immutable caching for hashed assets.

### 6. After deploying

1. **Settings → Gym:** name, address, phone. **Settings → Payments:** your UPI ID and payee name.
2. Create membership plans, team accounts and trainers.
3. **Data & Backup:** check storage; download your first backup.

---

## Configuration reference

### Worker `vars` (public, in `wrangler.jsonc`)

| Name | Default | Purpose |
|---|---|---|
| `ENVIRONMENT` | `development` | `production` hides API docs and enforces the secret checks |
| `ALLOWED_ORIGINS` | localhost:5173 | Comma-separated frontend origins for CORS |
| `GYM_TIMEZONE` / `GYM_UTC_OFFSET_MINUTES` | `Asia/Kolkata` / `330` | The gym's "today" for expiry, attendance and reports |
| `DEFAULT_COUNTRY_CODE` | `91` | Phone normalisation |
| `D1_MAX_BYTES` | `500000000` | Storage limit used for the usage meter (D1 free plan: 500 MB per database) |
| `D1_TIME_TRAVEL_DAYS` | `7` | Time Travel window (free plan: 7 days) |
| `D1_DATABASE_NAME` | `smartgym-db` | Shown in the Time Travel CLI command |
| `PASSWORD_ITERATIONS` | `20000` | PBKDF2 rounds (1,000–100,000); sized for the free plan's CPU budget |
| Optional | | `STAFF_TOKEN_HOURS` (12) · `REMEMBER_TOKEN_DAYS` (7) · `MEMBER_TOKEN_DAYS` (30) |

### Worker secrets (`npx wrangler secret put NAME`)

| Name | Needed for |
|---|---|
| `JWT_SECRET` | **Required.** Signs login tokens |
| `AUTH_SECRET` | **Required.** Pepper mixed into every password hash |
| `SETUP_TOKEN` | Optional one-time `/setup` page |
| `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `D1_DATABASE_ID` | Optional: in-app D1 Time Travel restore (token needs D1:Edit). Without them, Data & Backup shows the `wrangler` command instead |

For local development put the same names in `backend/.dev.vars` (copy `.dev.vars.example`).

### Frontend

`VITE_API_URL` is the **only** frontend setting and is public: empty for same-origin `/api`, otherwise the API's origin. The React app never contains secrets.

### In-app settings (Settings screen, `settings` table)

Gym profile · member code prefix · Direct UPI (on/off, UPI ID, payee name) · which events notify members · expiry reminders on/off · attendance (check-out on second scan, grace days, repeat-scan cooldown) · data retention (notification retention days, archive suggestion age, storage alerts).

**Saved settings apply everywhere at once.** The gym name appears on every screen and browser tab, in the installed app's name (`/api/manifest.webmanifest`), the iOS home-screen label, receipts, reports, backup file names and member messages. After *Save*:
- the admin's screens switch immediately (the saved values from the server are used directly; a new currency re-renders every screen);
- `/api/config`, the manifest, the Settings screen and UPI payment details always read the saved values (never a cache), so other devices pick up a new name on their next load, or when the app comes back to the front;
- other server-side uses (notification text, receipts, reports) follow within 15 seconds.

---

## Payments and memberships

**A membership is created only after a payment is PAID** — never by a UTR submission alone. Every payment gets a number `PAY-YYYY-NNNNNN` (and its receipt `RCT-YYYY-NNNNNN`).

| Method | How it's recorded |
|---|---|
| `CASH` | Staff record it at the desk → PAID, membership active immediately |
| `UPI` | At the desk (staff enter the 12-digit UTR) → PAID; or from the member app → **PENDING** until staff approve |
| `BANK_TRANSFER` | Staff record it with the bank reference → PAID |
| `CARD_MANUAL` | Card taken on the gym's own terminal; staff record the slip number → PAID. **SmartGym never sees card numbers, CVV, PINs or UPI PINs** |

**Direct UPI from the member app:**
1. The member picks a plan, pays the gym's UPI ID (QR or *Open UPI app*) and enters the 12-digit UTR → payment **PENDING**.
2. Staff check the credit in the gym's bank/UPI app and **Approve** (→ PAID, membership created in the same D1 batch) or **Reject** / mark **Failed** with a reason the member sees.
3. A UTR can be used once: a repeat shows *"This transaction reference has already been submitted."* A member can have only one pending payment and can withdraw it.

Desk payments carry an `Idempotency-Key`, so a double-tap or retry never records twice. Approving twice never extends a membership twice.

**Refunds** (admin) are recorded, not processed: the gym pays the money back itself, then records amount, method, reference, reason and date. The payment becomes REFUNDED; optionally the linked membership is cancelled and the member's status recalculated.

**Membership status:** more than 7 days left = ACTIVE, 7 days or fewer = EXPIRING, past the end date = EXPIRED (plus UPCOMING for renewals that start later, CANCELLED). A renewal starts the day after the current membership ends. Member statuses are ACTIVE, INACTIVE, SUSPENDED and EXPIRED.

---

## Attendance

- Each member has a QR pass `SG1.<random token>` — the token is opaque and contains no personal data. *Issue new QR* invalidates old screenshots.
- Scanning (camera or USB scanner), member ID or phone number checks the member in. One row per member per day (enforced by a unique index); repeat scans answer *Already checked in*, and an optional second scan records check-out.
- An expired membership answers **"Membership Expired. Please renew your membership."** (a configurable grace period is available in Settings).
- Each entry records its method: `QR` or `MANUAL`.

---

## Notifications

**In-app only.** Members see them in the app; team members in the bell. Types: membership activated / renewed, payment received / rejected / refunded, expiry reminders, membership expired, trainer assigned, welcome, announcements and storage alerts (admins).

The **daily cron** (`30 0 * * *` = 06:00 IST) in one run:
1. syncs membership and member statuses from indexed end dates,
2. creates expiry reminders **7, 3 and 1 day** before the end and **"Membership expired. Please renew to continue."** after it — each type at most once per member per day (de-duplicated in SQL, so re-running is safe),
3. deletes notifications older than the retention period (the only automatic clean-up; business records are never auto-deleted),
4. takes the daily storage snapshot and, while storage is at WARNING (80 %) or above, sends admins an in-app storage alert.

Admins can also run reminders manually and send announcements to active, expiring, expired or all members.

---

## Reports and receipts

Reports — **members, memberships, payments, attendance, expenses** (expenses: admin only) — are JSON from the API (up to 10,000 rows, 2-year ranges). The Reports page previews the summary and first rows, then builds **CSV** (Excel-ready, formula-safe) or a paginated **PDF** in the browser. Receipts are PDFs built the same way. Nothing is stored on the server.

---

## Data & Backup

An admin-only page with four tabs.

**Storage.** Database size (Used / Remaining / %), with status **HEALTHY** < 70 % · **MONITOR** 70–80 % · **WARNING** 80–90 % · **CRITICAL** 90–95 % · **ARCHIVE REQUIRED** > 95 %. It also shows rows and estimated size per table, growth per day, days until 80 %, and a suggestion of what can be archived (older than *Settings → Data retention*).

**Backup & archive** — four steps:
1. **Choose** data sets (attendance, payments & refunds, memberships, expenses, workout history, notifications, progress — members are always included) and a period.
2. **Download** a ZIP named after the gym, such as `Xavion_Fitness_Studio_Backup_2024.zip`, built in the browser from paged exports:
   ```
   metadata.json      backup id, gym, period, data sets, per-table row counts and columns, SHA-256 of every file
   members.csv  memberships.csv  payments.csv  refunds.csv  attendance.csv  expenses.csv
   workout_history.csv (plans + exercises, one row per exercise)  progress.csv  notifications.csv
   ```
3. **Verify** — the admin opens the saved file; the browser re-checks every file's SHA-256 against `metadata.json` and counts the rows; the server compares the counts with the backup record before marking it VERIFIED.
4. **Archive & remove** (optional) — tick *"I have downloaded and verified this backup"*, confirm, and the records of that period are removed in chunks (paused, not failed, if the D1 daily write allowance runs out). The newest 60 days, members, payments awaiting verification, active workout plans and anything newer than the backup are always kept. Database triggers allow these deletes only while a verified backup is archiving.

**Restore** — upload a backup ZIP → it is validated on the device (checksums, columns) → preview per table → existing records are detected → confirm → only missing records are added, parents before children. **Existing records are never overwritten**; rows whose member no longer exists are skipped and reported. Each restore is logged in the history.

**Time Travel** — restores the whole database to a moment in the last 7 days (D1 Time Travel). It shows a **WARNING**, then *Cancel / Continue*, then asks the admin to type `RESTORE`. Without the optional `CF_*` secrets it shows the exact `npx wrangler d1 time-travel restore …` command to run instead.

---

## Data model

Migrations are in `backend/migrations/` (0001–0006).

| Table | Purpose |
|---|---|
| `roles`, `users` | Logins for all roles; admins/staff sign in with e-mail or phone, trainers with e-mail/phone, members with their member ID |
| `members` | Profile, `user_id` (member app login), status, trainer, opaque `qr_token`, `created_by` |
| `trainers` | Trainer profiles (`user_id` when they have a login); assignment lives on `members.trainer_id` |
| `membership_plans` | Name, duration (days), price (paise), status |
| `memberships` | Member × plan with dates and the amount paid; created only by PAID payments |
| `payments` | `payment_number`, member, plan, membership, amount, method, `transaction_reference`, status, `payment_date`, `verified_by`/`verified_at`, notes, `created_by` |
| `refunds` | One recorded refund per payment |
| `attendance` | One row per member per day: `attendance_date`, check-in/out, `method` |
| `workout_plans`, `workout_exercises` | Trainer-made plans (exercise name, sets, reps, weight, rest, notes) |
| `body_measurements` | weight, height, body_fat, chest, waist, arm, thigh, `recorded_at` |
| `notifications` | `user_id`, type, message, UNREAD/READ, `read_at` |
| `expenses` | Category, amount, description, date, `created_by` |
| `settings` | Key/value gym settings |
| `backups` | Backup / restore / Time Travel history, watermarks, checksum, verified/archived by and at |
| `storage_snapshots` | One row per day: database size and row counts (for growth trends) |

**Conventions:** money is **integer paise**; timestamps are UTC (`YYYY-MM-DD HH:MM:SS`); calendar dates are gym-local; every list is paginated (20/50/100) and served by an index.

**Integrity enforced by the database, not only the API:** one pending payment per member · a UTR once per method · unique idempotency keys · unique payment numbers · one attendance row per member per day · a payment and its membership belong to the same member · confirmed payments are immutable · members can never be deleted · payments, refunds and memberships can be deleted only by a verified archive.

---

## Free plan: performance and D1 usage

The system is designed for **Workers Free** (10 ms CPU per request) and **D1 Free** (500 MB per database, 5M rows read / 100k rows written per day, 50 queries per invocation):

- **Passwords:** PBKDF2-SHA256 with 20,000 rounds plus a secret pepper (`AUTH_SECRET`) — fast enough for the CPU budget, while a leaked database alone can't be brute-forced. Raise `PASSWORD_ITERATIONS` on Workers Paid; hashes upgrade on the next sign-in.
- **Few round trips:** multi-statement reads (dashboard, member workspace, member app) and every multi-row write go to D1 in one `batch()` — also a transaction, so payment + membership + notification commit together.
- **Large results never become Python objects:** report and export rows are serialised by D1's JavaScript side and passed through as JSON text.
- **Indexed everything:** member search (code, phone, name prefixes), statuses, end dates, payment dates and queues are indexed; the cron job uses indexed date ranges.
- **Heavy work in the browser:** PDFs, CSVs, ZIPs and checksums are built on the admin's device.
- **Frontend:** lazy route chunks, `useApi` shares identical requests and reuses data younger than 15 s; any change invalidates what it touched.
- **Every response reports its cost** in `Server-Timing` (D1 trips, statements, rows read and written). Locally, typical calls take 20–45 ms with ≤ 10 ms of Worker time.

---

## Security

- **Passwords:** PBKDF2-SHA256 + per-user salt + pepper, constant-time comparison; a dummy hash runs for unknown users so timing doesn't reveal which logins exist.
- **Brute force:** accounts lock for 15 minutes after 5 wrong passwords, plus a per-IP Workers Rate Limiting binding (`LOGIN_LIMITER`).
- **Tokens:** HS256 JWTs with per-role lifetimes. A `token_version` makes password changes, *sign out everywhere*, disabling a user and revoking app access take effect (within 30 s on other isolates, which cache user records briefly). Temporary passwords must be changed at first sign-in.
- **Authorisation:** role checks on every route; trainers limited to assigned members; members only reach `/api/me/*`; restore and Time Travel are admin-only and require explicit confirmation.
- **No card data** is ever collected; UPI is paid directly to the gym, and SmartGym never asks for a UPI PIN.
- **Web:** strict CSP (no third-party scripts or frames), `X-Frame-Options: DENY`, `nosniff`, strict referrer policy, `no-store` on API responses, explicit CORS allowlist, 256 KB body limit, unknown request fields rejected, formula-safe CSV exports.
- **Errors:** human-readable messages; stack traces and SQL never reach the client.
- **Secrets:** only as Worker secrets or in the git-ignored `.dev.vars`. D1 is reachable only through the Worker binding; the frontend has only `VITE_API_URL`.

---

## PWA and offline behaviour

- **Installable** on Android, iOS and desktop (manifest, maskable icons, shortcuts), under the gym's own name: same-origin builds link the manifest the API serves from Settings (`/api/manifest.webmanifest`; a separate API origin falls back to the static `public/manifest.webmanifest`). Regenerate icons with `npm run icons`.
- The app shell is precached; screens are cached after first use. The member's QR pass is saved on the device and shows without signal.
- Every write needs the network. The service worker never caches `/api` responses.
- Hashed assets are immutable; `sw.js`/`index.html` are `no-cache`; a tab left open across a deploy recovers by reloading once.

---

## Design decisions and deviations

- **Tables beyond the brief:** `settings` (editable gym settings without redeploys), `refunds` (a refund is its own audited record), `backups` and `storage_snapshots` (Data & Backup history and growth trends).
- **Columns beyond the brief:** `payments.plan_id` (a PENDING payment knows its plan before any membership exists), `payments.idempotency_key`, `members.qr_token`, and the security columns on `users` (`token_version`, `failed_logins`, `locked_until`, `must_change_password`).
- **`jobs/` instead of `workers/`** for the cron package, because `workers` is the Cloudflare Python SDK module and would be shadowed.
- **Browser-built documents:** PDF, CSV and ZIP generation run in the browser to keep the Worker inside the free CPU budget and to store nothing server-side.
- **Out of scope by design:** payment gateways, SMS/WhatsApp/e-mail, file storage, photos, multi-branch.

## Known limitations

- **UPI verification is manual** by design (no gateway): staff must check each UTR against the gym's statement before approving.
- **Time Travel in the app** needs a Cloudflare API token with D1:Edit (`CF_*` secrets); otherwise use the shown `wrangler` command.
- **Timezone:** one fixed UTC offset per gym (no daylight saving) — correct for India.
- **Cold starts:** the first request after a Python Worker has been idle is slower (about 1–2 s). Later requests are fast.
