import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requireRole } from '../lib/auth'
import { readJson } from '../lib/body'
import { writeAudit } from '../lib/audit'
import { chargesSumSql } from '../lib/money'
import { normalizePhone } from '../lib/phone'
import { SQL_NOW, SQL_TODAY } from '../lib/time'
import type { AppEnv, BookingStatus, UnitType } from '../types'

const guests = new Hono<AppEnv>()

// Guest history exposes money, so it stays admin-only like the rest of it.
guests.use('*', requireRole('admin'))


type StayRow = {
  booking_id: number
  unit_name: string
  unit_type: UnitType
  guest_name: string
  date_from: string
  date_to: string
  status: BookingStatus
  total_amount: number
  prepaid_amount: number
  deposit_amount: number
  charges_total: number
  currency: string
}

/**
 * GET /api/guests/:phone — everything known about a returning guest.
 * Phone is the key because it is the one field that stays stable across
 * bookings; names get typed differently every time.
 */
guests.get('/:phone', async (c) => {
  const phone = normalizePhone(decodeURIComponent(c.req.param('phone')))
  if (!phone) throw new HTTPException(400, { message: 'Укажите телефон' })

  const { results: stays } = await c.env.DB.prepare(
    `SELECT b.id AS booking_id, u.name AS unit_name, u.type AS unit_type,
            b.guest_name, b.date_from, b.date_to, b.status,
            b.total_amount, b.prepaid_amount, b.deposit_amount, b.currency,
            ${chargesSumSql('b')} AS charges_total
     FROM bookings b
     JOIN units u ON u.id = b.unit_id
     WHERE replace(replace(replace(replace(b.guest_phone, ' ', ''), '(', ''), ')', ''), '-', '') = ?
     ORDER BY b.date_from DESC`
  )
    .bind(phone)
    .all<StayRow>()

  const notesRow = await c.env.DB.prepare(
    'SELECT notes, updated_at FROM guest_notes WHERE phone = ?'
  )
    .bind(phone)
    .first<{ notes: string; updated_at: string }>()

  const todayRow = await c.env.DB.prepare(`SELECT ${SQL_TODAY} AS today`).first<{ today: string }>()
  const today = todayRow?.today ?? new Date().toISOString().slice(0, 10)

  const past = stays.filter((stay) => stay.date_to.slice(0, 10) < today)
  const outstanding = stays.reduce(
    (sum, stay) =>
      sum + Math.max(0, stay.total_amount + stay.charges_total - stay.prepaid_amount),
    0
  )
  const lifetimeSpend = stays.reduce((sum, stay) => sum + stay.prepaid_amount, 0)

  return c.json({
    phone,
    // The most recent spelling of the name wins — guests get retyped.
    guest_name: stays[0]?.guest_name ?? null,
    total_stays: stays.length,
    past_stays: past.length,
    outstanding_debt: Number(outstanding.toFixed(2)),
    lifetime_spend: Number(lifetimeSpend.toFixed(2)),
    notes: notesRow?.notes ?? '',
    notes_updated_at: notesRow?.updated_at ?? null,
    stays: stays.map((stay) => ({
      booking_id: stay.booking_id,
      unit_name: stay.unit_name,
      unit_type: stay.unit_type,
      date_from: stay.date_from,
      date_to: stay.date_to,
      status: stay.status,
      total_amount: stay.total_amount,
      charges_amount: stay.charges_total,
      prepaid_amount: stay.prepaid_amount,
      deposit_amount: stay.deposit_amount,
      remaining_amount: Number(
        (stay.total_amount + stay.charges_total - stay.prepaid_amount).toFixed(2)
      ),
      currency: stay.currency,
    })),
  })
})

/** PUT /api/guests/:phone/notes — free-text preferences and warnings. */
guests.put('/:phone/notes', async (c) => {
  const staff = c.get('staff')
  const phone = normalizePhone(decodeURIComponent(c.req.param('phone')))
  if (!phone) throw new HTTPException(400, { message: 'Укажите телефон' })

  const body = await readJson<{ notes: string }>(c)
  const notes = String(body.notes ?? '')

  await c.env.DB.prepare(
    `INSERT INTO guest_notes (phone, notes, updated_at, updated_by)
     VALUES (?, ?, ${SQL_NOW}, ?)
     ON CONFLICT(phone) DO UPDATE SET
       notes = excluded.notes,
       updated_at = excluded.updated_at,
       updated_by = excluded.updated_by`
  )
    .bind(phone, notes, staff.sub)
    .run()

  await writeAudit(c.env.DB, staff.sub, 'guest.notes', 'guest_notes', null)
  return c.json({ phone, notes })
})

export default guests