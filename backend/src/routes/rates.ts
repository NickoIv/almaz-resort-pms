import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requireRole } from '../lib/auth'
import { writeAudit } from '../lib/audit'
import { readJson } from '../lib/body'
import { quoteStay, type Rate } from '../lib/rates'
import { SQL_NOW } from '../lib/time'
import type { AppEnv, UnitType } from '../types'

const rates = new Hono<AppEnv>()

const UNIT_TYPES: UnitType[] = ['room', 'sunbed', 'gazebo', 'vip_gazebo']

type RateBody = {
  unit_type: string
  category: string | null
  weekday_price: unknown
  weekend_price: unknown
  season_name?: string | null
  season_from?: string | null
  season_to?: string | null
}

/** A price is a number that is not negative. Everything else is a typo. */
function money(value: unknown, field: string): number {
  const amount = Number(value ?? 0)
  if (!Number.isFinite(amount) || amount < 0) {
    throw new HTTPException(400, { message: `Некорректная цена в поле «${field}»` })
  }
  return Number(amount.toFixed(2))
}

/** `YYYY-MM-DD`, or nothing. */
function day(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === '') return null
  const text = String(value).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new HTTPException(400, { message: `Некорректная дата в поле «${field}»` })
  }
  return text
}

/** The whole price list. Exported so the transfer quote cannot drift from it. */
export async function loadRates(db: D1Database): Promise<Rate[]> {
  const { results } = await db
    .prepare(
      `SELECT id, unit_type, category, weekday_price, weekend_price,
              season_name, season_from, season_to
         FROM rates
        ORDER BY unit_type, category, season_from`
    )
    .all<Rate>()
  return results
}

/**
 * GET /api/rates — the whole price list.
 *
 * Admin only, like everything else that carries money.
 */
rates.get('/', requireRole('admin'), async (c) => {
  return c.json({ rates: await loadRates(c.env.DB) })
})

/**
 * PUT /api/rates — replace the list wholesale.
 *
 * A price list is edited as a table, not row by row: the admin adds a season,
 * retypes two numbers and saves. Sending the whole set means the screen and the
 * database cannot drift apart, and there is no half-applied state where a
 * season exists but its prices do not.
 */
rates.put('/', requireRole('admin'), async (c) => {
  const staff = c.get('staff')
  const body = await readJson<{ rates: RateBody[] }>(c)
  const incoming = Array.isArray(body.rates) ? body.rates : []

  if (incoming.length > 200) {
    throw new HTTPException(400, { message: 'Слишком много строк в прайс-листе' })
  }

  const rows = incoming.map((row) => {
    if (!UNIT_TYPES.includes(row.unit_type as UnitType)) {
      throw new HTTPException(400, { message: `Неизвестный тип объекта: ${row.unit_type}` })
    }
    const from = day(row.season_from, 'начало сезона')
    const to = day(row.season_to, 'конец сезона')
    if (from && to && from > to) {
      throw new HTTPException(400, { message: 'Сезон заканчивается раньше, чем начинается' })
    }
    return {
      unit_type: row.unit_type as UnitType,
      // An empty category box means "any", which is a real and useful row —
      // not a missing value to reject.
      category: row.category ? String(row.category).slice(0, 60) : null,
      weekday_price: money(row.weekday_price, 'будни'),
      weekend_price: money(row.weekend_price, 'выходные'),
      season_name: row.season_name ? String(row.season_name).slice(0, 60) : null,
      season_from: from,
      season_to: to,
    }
  })

  const statements = [
    c.env.DB.prepare('DELETE FROM rates'),
    ...rows.map((row) =>
      c.env.DB.prepare(
        `INSERT INTO rates
           (unit_type, category, weekday_price, weekend_price,
            season_name, season_from, season_to, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ${SQL_NOW}, ?)`
      ).bind(
        row.unit_type,
        row.category,
        row.weekday_price,
        row.weekend_price,
        row.season_name,
        row.season_from,
        row.season_to,
        staff.sub
      )
    ),
  ]
  await c.env.DB.batch(statements)

  await writeAudit(c.env.DB, staff.sub, 'rates.update', 'rates', null)
  return c.json({ rates: await loadRates(c.env.DB) })
})

/**
 * GET /api/rates/quote — what the list says this stay costs.
 *
 * A suggestion, not a decision: the booking form fills the amount in and
 * whoever is at the desk can type over it. `empty: true` means the list has
 * nothing to say about this unit and the form must leave the field alone.
 */
rates.get('/quote', requireRole('admin'), async (c) => {
  const unitId = Number(c.req.query('unit_id'))
  const dateFrom = c.req.query('date_from') ?? ''
  const dateTo = c.req.query('date_to') ?? ''

  if (!Number.isInteger(unitId)) throw new HTTPException(400, { message: 'Не указан объект' })
  if (!dateFrom || !dateTo) throw new HTTPException(400, { message: 'Не указаны даты' })

  const unit = await c.env.DB.prepare('SELECT id, type, category FROM units WHERE id = ?')
    .bind(unitId)
    .first<{ id: number; type: UnitType; category: string | null }>()
  if (!unit) throw new HTTPException(404, { message: 'Объект не найден' })

  const quote = quoteStay(await loadRates(c.env.DB), unit, dateFrom, dateTo)
  return c.json(quote)
})

export default rates
