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
npm run db:migrate:local    # apply migrations to the local D1 database
npm run dev                 # http://localhost:8787

# Frontend
cd frontend
npm install
npm run dev                 # http://localhost:5173
```

## Database migrations

Migrations live in `backend/migrations/` and are applied with Wrangler:

```bash
cd backend
npm run db:migrate:local     # local development database
npm run db:migrate:remote    # remote Cloudflare D1 database
```

## Status

Work in progress. Currently implemented: project scaffolding, D1 schema and seed data.