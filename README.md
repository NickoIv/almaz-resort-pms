# Almaz Resort PMS

Booking and management system (PMS) for a hotel and restaurant recreation area in **Almaty, Kazakhstan**.

The complex consists of:

- **Hotel** — 14 rooms (numbered 101–114)
- **Restaurant recreation area** — sunbeds (топчаны), gazebos (беседки) and VIP gazebos (VIP-беседки)

A single web panel gives the administrator and staff full control over bookings, payments,
housekeeping and analytics.

## Live

| | |
| --- | --- |
| **App** | https://almaz-resort-pms.pages.dev |
| **API** | https://almaz-resort-pms-api.nickru777.workers.dev |

## Modules

| Module | Description |
| --- | --- |
| Rooms | Status, occupancy calendar, cleaning checklist, payment / prepayment / balance, guest details |
| Restaurant & recreation area | Sunbeds, gazebos and VIP gazebos — same model, booked by the hour |
| Roles | Administrator, housekeeper, waiter — each with its own restricted dashboard |
| Notifications | Check-in / check-out, overdue cleaning, unpaid balance — via WhatsApp (Green API), Telegram optional |
| Analytics | Revenue by rooms and by restaurant, seasonal statistics, top returning guests |

## Tech stack

- **Frontend** — React + Vite + TypeScript, deployed to Cloudflare Pages
- **Backend** — Cloudflare Workers + Hono (TypeScript)
- **Database** — Cloudflare D1 (SQLite)
- **Auth** — own implementation (phone + PIN for staff), roles stored in the database
- **Notifications** — WhatsApp via Green API, with Telegram as an optional second channel
- **Hosting** — GitHub + Cloudflare Pages, auto-deploy on push to `main`

## Repository layout

```
/frontend    React + Vite + TypeScript app
/backend     Cloudflare Worker (Hono) + D1 migrations
```

## Database schema

| Table | Purpose |
| --- | --- |
| `units` | Bookable units — rooms, sunbeds, gazebos, VIP gazebos |
| `bookings` | Reservations with dates, status and payment amounts |
| `cleaning_checklist` | Per-unit housekeeping items |
| `staff_users` | Staff accounts with role and hashed PIN |
| `payments` | Individual payment records against a booking |
| `audit_log` | Who changed what and when — surfaced on the admin Journal screen |
| `settings` | Key/value toggles for the notification digest |

`payments` is the ledger: every change to what a guest has paid writes a row there,
including the prepayment entered when a booking is created and any manual
correction (booked as an `adjustment`, which may be negative). `bookings.prepaid_amount`
is the cached sum. Revenue reporting reads the ledger, so the two must not drift.

## Getting started

```bash
# Backend (Cloudflare Worker)
cd backend
npm install
cp .dev.vars.example .dev.vars   # then put a long random string in JWT_SECRET
npm run db:migrate:local         # apply migrations to the local D1 database
npm run dev                      # http://localhost:8787

# Frontend (in a second terminal)
cd frontend
npm install
npm run dev                      # http://localhost:5173, /api is proxied to the Worker
```

## Staff accounts

Seeded by `0003_seed_staff.sql`. **Change these PINs before going live.**

| Role | Phone | PIN | Sees |
| --- | --- | --- | --- |
| Администратор | `+77011112233` | `1234` | Everything — rooms, bookings, payments, cleaning |
| Горничная | `+77022223344` | `2345` | Only the cleaning checklists for rooms |
| Официант | `+77033334455` | `3456` | Only the restaurant / recreation units |

Staff log in with phone + PIN and receive a JWT that carries their role. PINs are
stored as PBKDF2-SHA256 hashes (100k iterations); the token is signed with
`JWT_SECRET`, which lives in `.dev.vars` locally and in a Wrangler secret in production.

## API

| Method | Route | Access |
| --- | --- | --- |
| `POST` | `/api/auth/login` | public |
| `GET` | `/api/auth/me` | any signed-in staff |
| `GET` | `/api/units` | role-scoped (admin all, housekeeper rooms, waiter restaurant) |
| `GET` | `/api/units/:id` | role-scoped |
| `GET` | `/api/units/:id/calendar?month=YYYY-MM` | role-scoped |
| `GET` `POST` `PATCH` | `/api/bookings` | admin, waiter (waiter restricted to restaurant units) |
| `PATCH` | `/api/bookings/:id/payment` | admin only |
| `GET` | `/api/bookings/:id/payments` | admin only |
| `POST` | `/api/bookings/quick` | admin, waiter — hourly quick-booking, recreation units only |
| `POST` | `/api/bookings/group` | admin, waiter — one event across several units |
| `GET` | `/api/bookings/group/:id` | admin only |
| `PATCH` | `/api/bookings/group/:id/payment` | admin only — one combined instalment |
| `GET` `POST` `DELETE` | `/api/bookings/:id/charges` | admin only — penalties and extras |
| `GET` | `/api/guests/:phone` | admin only — stay history, debt, notes |
| `PUT` | `/api/guests/:phone/notes` | admin only |
| `GET` `PATCH` | `/api/cleaning` | admin, housekeeper |
| `GET` | `/api/analytics/summary?from=&to=` | admin only |
| `GET` | `/api/audit` | admin only — staff action log, filterable and paged |
| `GET` | `/api/audit/filters` | admin only |
| `GET` `PUT` | `/api/settings` | admin only — notification toggles and delivery channel |
| `GET` | `/api/settings/preview` | admin only — the digest as it stands, without sending |
| `POST` | `/api/settings/test-notification` | admin only — send the digest now, to the chosen channel |

Money amounts are stripped from every response for non-admin roles. The one
exception is a boolean `is_paid` on the current booking — a waiter has to know
whether a guest still owes, without seeing the figures.

## Booking units by night vs by hour

Rooms are sold by night: a stay stored as `2026-08-08` → `2026-08-11` occupies the
whole of the 9th and 10th. Recreation units are sold by the hour and store a full
timestamp (`2026-08-08 14:00`), so a gazebo is only busy between those times.
The status queries switch on `units.type` to apply the right comparison
(`backend/src/lib/time.ts`).

Bookings are stored as Almaty wall-clock time (UTC+5, no DST). D1's `now` is UTC,
so every comparison against "now" shifts it first.

## How a booking's money adds up

```
  total_amount        the unit rate
+ charges             penalties / extras (damage, late checkout) — table `charges`
= billed
− prepaid_amount      what the guest has actually paid
= remaining_amount    what is still owed

  deposit_amount      refundable security hold — NEVER part of the above
```

`deposit_amount` is deliberately outside the balance: it is money held, not money
owed, and merging the two makes a room look unpaid when it is not. The UI shows it
in its own block for the same reason.

`payments` is the ledger — analytics reads it, `prepaid_amount` is the cached sum.
Any path that takes money writes a `payments` row, including the upfront
prepayment on a new booking and a direct correction of `prepaid_amount`.

## Group bookings

One event can reserve several units. Each unit still gets its own booking row, so
availability, calendars and cleaning are untouched; `booking_groups` ties them
together and the event price is split across the units in whole tenge, with the
first absorbing any rounding remainder so the parts always add back to the quoted
total. Creation is all-or-nothing — every unit is validated before anything is
written, so one clash cannot leave half a group behind.

A combined group payment is stored as **one `payments` row per booking sharing a
`group_id`**, allocated in proportion to what each booking still owes. That keeps
the ledger per-booking (so analytics can still join through to a unit type) while
the UI presents it back as the single payment the guest actually made.

## Notifications

The scheduled Worker builds one digest (check-ins and check-outs today, overdue
cleaning, unpaid balances) and delivers it to the channel chosen on the Settings
screen: **whatsapp** (default), **telegram**, or **both**. The choice lives in
`settings.notify_channel`; credentials are Wrangler secrets and never touch the
database.

The digest is built as structured data and rendered per channel — WhatsApp gets
`*bold*`, Telegram gets HTML with guest text escaped, and the Settings preview
gets plain text. Rendering once as HTML and un-escaping it for the others is what
produces double-escaped names, so it is deliberately avoided.

WhatsApp goes through [Green API](https://green-api.com): free tier, no card, and
no template approval because it drives a real WhatsApp account. Set
`GREEN_API_INSTANCE_ID`, `GREEN_API_TOKEN` and `GREEN_API_CHAT_ID` (a phone
number, or a group id ending in `@g.us`); `GREEN_API_URL` is optional and only
needed if your instance is on a dedicated host.

With `both`, each channel is attempted independently — a Telegram outage cannot
stop the WhatsApp message.

## Analytics

`GET /api/analytics/summary` reports **collected** revenue — the sum of rows in
`payments` — rather than quoted booking totals, so an unpaid booking is not
counted as income. It returns revenue by unit type and by category (rooms vs
recreation), room occupancy for the range, a six-month series for the chart, and
the month-over-month change.

Occupancy counts room-nights from **all** bookings regardless of status, because a
guest who has checked out is set back to `free`; filtering that away would report
~0% for any past period. `bookings.status` has no separate `cancelled` state, so a
cancelled booking currently counts toward occupancy — worth adding when the status
enum is next revisited.

## Database migrations

Migrations live in `backend/migrations/` and are applied with Wrangler:

```bash
cd backend
npm run db:migrate:local     # local development database
npm run db:migrate:remote    # remote Cloudflare D1 database
```

## Notifications

A scheduled Worker posts a digest to a Telegram chat twice a day — **09:00 and
18:00 Almaty time** (`crons = ["0 4 * * *", "0 13 * * *"]` in `wrangler.toml`,
which is UTC). It reports:

- 🛎 check-ins due today
- 🚪 check-outs due today, with any outstanding balance
- 🧹 overdue cleaning — units that are free right now but whose checklist is unfinished
- 💰 unpaid balances on active and upcoming bookings

Each of the four can be switched off by an admin under **Настройки**. When every
enabled check comes back empty the job stays silent rather than posting an empty
message. The settings screen also previews the digest as it stands and can send a
test message on demand.

### Connecting the Telegram bot

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy the token.
2. Add the bot to the group that should receive the digest, then get the chat id
   (for a group it is negative, e.g. `-1001234567890`) — the easiest way is
   `https://api.telegram.org/bot<TOKEN>/getUpdates` after posting a message in the group.
3. Store both as Wrangler secrets — **never in code or in the database**:

```bash
cd backend
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
```

4. Open **Настройки** in the app and press **Отправить тест**.

Until both secrets are set the cron job logs a warning and skips, and the test
button returns a clear "Telegram не настроен" message.

## Deployment

Both halves live in the Cloudflare account that owns the D1 database.

### One-time setup

```bash
# 1. Database
cd backend
npx wrangler d1 create almaz_resort_pms_db      # copy database_id into wrangler.toml
npx wrangler d1 migrations apply DB --remote

# 2. Worker secrets
npx wrangler secret put JWT_SECRET              # a long random string
npx wrangler secret put TELEGRAM_BOT_TOKEN      # optional, for notifications
npx wrangler secret put TELEGRAM_CHAT_ID        # optional, for notifications

# 3. Worker
npx wrangler deploy

# 4. Pages project
cd ../frontend
npx wrangler pages project create almaz-resort-pms --production-branch main
```

### Deploying by hand

```bash
cd backend  && npx wrangler deploy
cd frontend && VITE_API_URL=https://almaz-resort-pms-api.nickru777.workers.dev npm run build
npx wrangler pages deploy dist --project-name almaz-resort-pms --branch main
```

`VITE_API_URL` is baked in at build time; without it the app calls a same-origin
`/api`, which only works behind the local dev proxy.

### Automatic deployment on push to `main`

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) typechecks, lints and
builds on every push, then deploys the Worker (applying D1 migrations first) and
Pages. It needs two repository **secrets** and one **variable**:

| Name | Kind | Value |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | secret | Token with *Workers Scripts: Edit*, *Cloudflare Pages: Edit*, *D1: Edit* |
| `CLOUDFLARE_ACCOUNT_ID` | secret | The Cloudflare account id (already set) |
| `VITE_API_URL` | variable | Public Worker URL (already set) |

Create the token at **Cloudflare dashboard → My Profile → API Tokens → Create
Token**, then add it with:

```bash
gh secret set CLOUDFLARE_API_TOKEN
```

Until that token exists the workflow still builds and typechecks, but **skips**
the deploy steps rather than failing.

> The Pages project was created through Wrangler, so it is a direct-upload project
> and the deploy runs through the workflow above. To use Cloudflare's own Git
> integration instead, connect the repo under **Workers & Pages → almaz-resort-pms
> → Settings → Builds**, set the build command to `npm run build`, the output
> directory to `dist`, the root directory to `frontend`, and add `VITE_API_URL` as
> a build environment variable.

## Status

Work in progress.

- [x] Project scaffolding, D1 schema and seed data
- [x] Staff authentication (phone + PIN → JWT) and role-based access control
- [x] Rooms module — dashboard grid, monthly calendar, payments, cleaning checklist
- [x] Restaurant / recreation module — hourly booking, waiter quick-book, tabs per type
- [x] Analytics dashboard — revenue, occupancy, month-over-month, CSV export
- [x] Notifications: WhatsApp via Green API (cron digest + admin settings screen), Telegram optional
- [x] Search and status filter, guest history, group bookings, extra charges
- [x] Audit log screen — who changed which booking, and when
- [x] Deployed to Cloudflare Workers + Pages
- [ ] Change the seeded staff PINs before going live

Not done yet: `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` are not set, so no
notification has actually been delivered — see *Connecting the Telegram bot*.