# Almaz Resort PMS

Booking and management system (PMS) for a hotel and restaurant recreation area in **Almaty, Kazakhstan**.

The complex consists of:

- **Hotel** — 14 rooms (numbered 101–114)
- **Restaurant recreation area** — sunbeds (топчаны), gazebos (беседки) and VIP gazebos (VIP-беседки)

A single web panel gives the administrator and staff full control over bookings, payments,
housekeeping and analytics.

## Modules

| Module | Description |
| --- | --- |
| Rooms | Status, occupancy calendar, cleaning checklist, payment / prepayment / balance, guest details |
| Restaurant & recreation area | Sunbeds, gazebos and VIP gazebos — same model, booked by the hour |
| Roles | Administrator, housekeeper, waiter — each with its own restricted dashboard |
| Notifications | Check-in / check-out, overdue cleaning, unpaid balance — via a Telegram bot |
| Analytics | Revenue by rooms and by restaurant, seasonal statistics, top returning guests |

## Tech stack

- **Frontend** — React + Vite + TypeScript, deployed to Cloudflare Pages
- **Backend** — Cloudflare Workers + Hono (TypeScript)
- **Database** — Cloudflare D1 (SQLite)
- **Auth** — own implementation (phone + PIN for staff), roles stored in the database
- **Notifications** — Telegram Bot API
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
| `audit_log` | Who changed what and when |

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
| `GET` `PATCH` | `/api/cleaning` | admin, housekeeper |
| `GET` | `/api/analytics/summary?from=&to=` | admin only |

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

## Status

Work in progress.

- [x] Project scaffolding, D1 schema and seed data
- [x] Staff authentication (phone + PIN → JWT) and role-based access control
- [x] Rooms module — dashboard grid, monthly calendar, payments, cleaning checklist
- [x] Restaurant / recreation module — hourly booking, waiter quick-book, tabs per type
- [x] Analytics dashboard — revenue, occupancy, month-over-month, CSV export
- [ ] Telegram notifications and deployment