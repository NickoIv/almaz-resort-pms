import { HTTPException } from 'hono/http-exception'

/**
 * How money is recorded, and by whom.
 *
 * Two rules live here, both of them about a ledger that has to be defensible
 * at the end of a shift rather than merely plausible.
 *
 * **The method is never guessed.** It used to fall back to `'cash'` whenever a
 * caller left it out, so a Kaspi transfer entered without touching the selector
 * was filed as cash. Nobody discovers that on the day; they discover it when
 * the till is short and there is nothing in the record to explain it. An
 * unspecified method is now a rejected request.
 *
 * **The taker is not the recorder.** Only an admin may enter a payment, but the
 * admin is frequently not the person the guest handed the money to — a waiter
 * takes it at a gazebo and it is entered afterwards. Those are two different
 * facts about one payment and the row keeps both.
 */

/**
 * What a person can choose. Must stay in step with the selector in
 * PaymentModal — `transfer` is in this list because that selector offers
 * «Перевод», and validating without it would start rejecting a payment method
 * the app has been offering all along.
 */
export const PAYMENT_METHODS = ['cash', 'card', 'kaspi', 'transfer'] as const

export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

/**
 * Written by the system, never by a person: the balancing entry when an admin
 * corrects `prepaid_amount` outright instead of adding an instalment. It is
 * kept out of PAYMENT_METHODS so it cannot be selected, and so a report can
 * tell real money apart from a correction.
 */
export const ADJUSTMENT_METHOD = 'adjustment'

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === 'string' && (PAYMENT_METHODS as readonly string[]).includes(value)
}

/**
 * The method for a payment a person is entering.
 *
 * Deliberately has no default. Every caller either has a person in front of a
 * selector or is not recording a real payment at all.
 */
export function assertPaymentMethod(value: unknown): PaymentMethod {
  if (!isPaymentMethod(value)) {
    throw new HTTPException(400, {
      message: `Укажите способ оплаты: ${PAYMENT_METHODS.join(', ')}`,
    })
  }
  return value
}

/**
 * Resolves who physically took the money.
 *
 * Absent, it is the person doing the recording — the ordinary case, where the
 * admin took the payment themselves. Given, it must name an **active** member
 * of staff: attributing cash to a disabled account would be a way to make money
 * disappear into a name nobody can ask about.
 */
export async function resolveReceivedBy(
  db: D1Database,
  value: unknown,
  recordedBy: number
): Promise<number> {
  if (value === undefined || value === null || value === '') return recordedBy

  const id = Number(value)
  if (!Number.isInteger(id)) {
    throw new HTTPException(400, { message: 'Некорректный сотрудник, принявший оплату' })
  }
  if (id === recordedBy) return recordedBy

  const staff = await db
    .prepare('SELECT id FROM staff_users WHERE id = ? AND is_active = 1')
    .bind(id)
    .first<{ id: number }>()

  if (!staff) {
    throw new HTTPException(400, {
      message: 'Оплату можно записать только на действующего сотрудника',
    })
  }
  return id
}
