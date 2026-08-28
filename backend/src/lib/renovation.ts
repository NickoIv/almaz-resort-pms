import { HTTPException } from 'hono/http-exception'

/**
 * Объект на реставрации.
 *
 * The hotel building is not finished. Its rooms are in the database because
 * they are planned and priced, but they do not physically exist yet — and the
 * one thing the app must never do is let somebody sell a night in a room that
 * has no roof.
 *
 * ## Why this is not a `unit_block`
 *
 * A block is an **interval on the calendar**: «107 снят с продажи с 10 по 15,
 * ремонт». It has an end, it is written when the dates are known, and it
 * answers «что можно продать на эти числа». Renovation is a property of the
 * **object**: the room is not there, nobody knows the opening date, and the
 * question it answers is «сколько у нас вообще номеров». Expressing it as a
 * block would mean inventing an end date and then extending it every time the
 * invented date arrived — and a block that is always extended is a lie that
 * has to be maintained.
 *
 * ## Why it is not a `BookingStatus` either
 *
 * `free / booked / occupied` are states of a **stay**, derived from the
 * bookings table. «На реставрации» is not a stay in any state; it is the
 * absence of a sellable object. Adding a fourth value to that union would put
 * a thing that has no booking into a type that means "the booking is …", and
 * every switch over the union would have to invent a case for it.
 */

/** Not under renovation is the normal case, and it is `NULL`, not a flag. */
export type Renovation = {
  since: string
  note: string | null
  by_name?: string | null
}

/**
 * Refuses to sell a room that does not exist yet.
 *
 * Lives inside `assertSellable` beside `assertNotBlocked`, so all five paths
 * that write a booking — обычная, быстрая, групповая, правка дат, переселение —
 * get it from one place. A rule that four of the five obey is a room under
 * renovation right up until somebody presses the other button.
 */
export async function assertNotUnderRenovation(
  db: D1Database,
  unitId: number
): Promise<void> {
  const unit = await db
    .prepare('SELECT name, renovation_since, renovation_note FROM units WHERE id = ?')
    .bind(unitId)
    .first<{ name: string; renovation_since: string | null; renovation_note: string | null }>()

  if (!unit?.renovation_since) return

  // The note is the whole point of carrying one: «до конца сентября» is the
  // difference between a refusal a person can act on and a wall.
  throw new HTTPException(409, {
    message:
      `${unit.name} на реставрации с ${unit.renovation_since.slice(0, 10)} — бронировать нельзя` +
      (unit.renovation_note ? `. ${unit.renovation_note}` : ''),
  })
}

/**
 * «Из чего вообще можно продавать» — одним выражением на всё приложение.
 *
 * Занятость, прогноз и годовой график считают долю проданного, и объект на
 * реставрации обязан выйти из знаменателя, а не тянуть показатель вниз: 60%
 * из-за того, что корпус ещё строится, — ответ на вопрос, которого никто не
 * задавал. Ровно то же правило уже действует для снятых с продажи ночей
 * (`nights_blocked` в аналитике), и расходиться этим двум нельзя.
 */
export const SQL_NOT_UNDER_RENOVATION = 'renovation_since IS NULL'
