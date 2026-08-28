import { useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../api'
import { useAuth } from '../auth'
import BookingVerifyCard from './BookingVerifyCard'
import { Alert, Modal } from './ui'
import { addDaysIso, todayIso } from '../format'
import { CANCEL_REASONS, CANCEL_REASON_LABELS, needsNote, type CancelReason } from '../cancellation'
import { dateRange } from '../format'
import {
  CURRENCIES,
  CURRENCY_LABELS,
  DEFAULT_CURRENCY,
  type Booking,
  type Currency,
  CITIZENSHIPS,
  KZ_CITIZENSHIP,
  type KnownGuest,
  type Quote,
  type StaffMember,
  type UnitStatus,
  type UnitType,
  type WaitlistEntry,
} from '../types'
import { money, pluralRu, shortDate } from '../format'

type Props = {
  unitId: number
  /** Needed so a clash can be turned into a waitlist entry of the right type. */
  unitType: UnitType
  /**
   * Shown on the verification card. Optional because the id is enough to book;
   * the name is only needed when the booking is read back to a person, and
   * "Номер 107" is what they can check against — an id is not.
   */
  unitName?: string
  booking: Booking | null
  canSetPrice: boolean
  /** Recreation units are sold by the hour, so the form switches to date+time. */
  hourly?: boolean
  /**
   * Pre-fills the dates. The planning board opens this form on whichever run
   * of nights was dragged, which is the whole point of dragging them.
   */
  initialFrom?: string
  initialTo?: string
  onClose: () => void
  onSaved: () => void
}

/** `2026-08-08 14:00` <-> the `datetime-local` input's `2026-08-08T14:00`. */
function toInput(value: string | null | undefined, hourly: boolean, fallback: string): string {
  if (!value) return fallback
  return hourly ? value.slice(0, 16).replace(' ', 'T') : value.slice(0, 10)
}

function toApi(value: string, hourly: boolean): string {
  return hourly ? value.replace('T', ' ').slice(0, 16) : value.slice(0, 10)
}

/** Create or edit a booking. Money fields only appear for the admin. */
export default function BookingModal({
  unitId,
  unitType,
  unitName,
  booking,
  canSetPrice,
  hourly = false,
  initialFrom,
  initialTo,
  onClose,
  onSaved,
}: Props) {
  const start = initialFrom ?? todayIso()
  const end = initialTo ?? addDaysIso(start, 1)
  const defaultFrom = hourly ? `${start}T12:00` : start
  const defaultTo = hourly ? `${start}T16:00` : end

  const { user } = useAuth()

  const [guestName, setGuestName] = useState(booking?.guest_name ?? '')
  const [guestPhone, setGuestPhone] = useState(booking?.guest_phone ?? '')
  const [dateFrom, setDateFrom] = useState(toInput(booking?.date_from, hourly, defaultFrom))
  const [dateTo, setDateTo] = useState(toInput(booking?.date_to, hourly, defaultTo))
  const [status, setStatus] = useState<UnitStatus>(booking?.status ?? 'booked')
  /**
   * Гражданство и документ — only asked for a room, and only because
   * Kazakhstan requires the hotel to notify the migration service about a
   * foreign guest within three days of arrival.
   *
   * Blank is a real answer and the default one: **most guests here are Kazakh,
   * and an empty field is not treated as foreign**. Marking someone «Казахстан»
   * takes one choice and settles it for good; leaving it blank puts the arrival
   * on the Миграционный учёт page under "не указано", so a foreign guest cannot
   * be missed by silence either.
   */
  const [citizenship, setCitizenship] = useState(booking?.guest_citizenship ?? '')
  const [otherCountry, setOtherCountry] = useState(
    booking?.guest_citizenship &&
      !CITIZENSHIPS.some((item) => item.value === booking.guest_citizenship)
      ? booking.guest_citizenship
      : ''
  )
  const [document, setDocument] = useState(booking?.guest_document ?? '')
  /**
   * Событие в костровой зоне считается от числа гостей, а не от числа часов:
   * банкетное меню от 17 000 ₸ с человека. Итог можно поставить руками —
   * администратор торгуется, — и тогда он побеждает расчёт.
   */
  const isBanquet = unitType === 'banquet_zone'
  const [guests, setGuests] = useState(String(booking?.guests_count ?? ''))
  const [perPerson, setPerPerson] = useState(String(booking?.price_per_person ?? ''))
  const [total, setTotal] = useState(String(booking?.total_amount ?? ''))
  const [prepaid, setPrepaid] = useState(String(booking?.prepaid_amount ?? ''))
  const [deposit, setDeposit] = useState(String(booking?.deposit_amount ?? ''))
  const [currency, setCurrency] = useState<Currency>(
    (booking?.currency as Currency) ?? DEFAULT_CURRENCY
  )

  // A prepayment is a real payment, so it carries the same two facts: by what
  // means, and into whose hands. Neither is guessed — the method starts empty
  // and the server refuses a payment without one.
  const [paymentMethod, setPaymentMethod] = useState('')
  const [receivedBy, setReceivedBy] = useState<string>(String(user?.id ?? ''))
  const [staff, setStaff] = useState<StaffMember[]>([])

  useEffect(() => {
    if (!canSetPrice) return
    api<StaffMember[]>('/staff')
      .then((rows) => setStaff(rows.filter((member) => member.is_active)))
      .catch(() => setStaff([]))
  }, [canSetPrice])

  /**
   * What the price list says this stay costs, and whether anyone has overruled
   * it.
   *
   * The amount used to be typed from memory on every booking — the most
   * repeated action in the app and the one where a Friday quietly gets charged
   * a Tuesday price. The list fills it in; `priceTouched` makes sure that once
   * a human has typed a figure, nothing ever moves it again.
   */
  const [quote, setQuote] = useState<Quote | null>(null)
  const [priceTouched, setPriceTouched] = useState(false)

  useEffect(() => {
    // Only for a booking being made. An existing one has a price that was
    // already agreed with the guest; re-quoting it would rewrite history.
    if (!canSetPrice || booking) return
    const from = toApi(dateFrom, hourly)
    const to = toApi(dateTo, hourly)
    if (!from || !to) return

    let abandoned = false
    api<Quote>(
      `/rates/quote?unit_id=${unitId}` +
        `&date_from=${encodeURIComponent(from)}&date_to=${encodeURIComponent(to)}`
    )
      .then((result) => {
        if (!abandoned) setQuote(result.empty ? null : result)
      })
      // No price list, or none covering this unit: the field stays as it was.
      .catch(() => {
        if (!abandoned) setQuote(null)
      })
    return () => {
      abandoned = true
    }
  }, [canSetPrice, booking, unitId, dateFrom, dateTo, hourly])

  useEffect(() => {
    if (!quote || priceTouched) return
    setTotal(String(quote.total))
  }, [quote, priceTouched])

  /**
   * What is already known about this guest, if the phone has been seen before.
   *
   * The data has been there since guest history was built; it was just never
   * shown at the moment it changes a decision. Someone who owes money from
   * last time, or has a note saying "не селить у бассейна", should be visible
   * while the booking is being written — not after.
   */
  const [known, setKnown] = useState<KnownGuest | null>(null)

  useEffect(() => {
    if (!canSetPrice) return
    const digits = guestPhone.replace(/\D/g, '')
    if (digits.length < 10) {
      setKnown(null)
      return
    }
    let abandoned = false
    const timer = setTimeout(() => {
      api<KnownGuest>(`/guests/${encodeURIComponent(guestPhone)}`)
        .then((result) => {
          // A phone with no stays behind it is not a returning guest.
          if (!abandoned) setKnown(result.total_stays > 0 || result.notes ? result : null)
        })
        .catch(() => {
          if (!abandoned) setKnown(null)
        })
      // Typed, not pasted: without this every digit is a request.
    }, 500)
    return () => {
      abandoned = true
      clearTimeout(timer)
    }
  }, [canSetPrice, guestPhone])

  const [cancelReason, setCancelReason] = useState<CancelReason>('checked_out')
  const [cancelNote, setCancelNote] = useState('')

  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  /**
   * The booking this form has just written, held so it can be read back for
   * checking. Once it is set the form is editing that booking rather than
   * making a new one — «Исправить» must correct what was saved, not save a
   * second copy of it.
   */
  const [created, setCreated] = useState<Booking | null>(null)
  /** True while the card has been sent back to the form to be corrected. */
  const [fixing, setFixing] = useState(false)
  // Set when the API refuses the dates as taken; turns the form into a
  // waitlist offer rather than a dead end.
  const [clash, setClash] = useState(false)
  const [waitlisted, setWaitlisted] = useState(false)
  const [matches, setMatches] = useState<WaitlistEntry[]>([])

  /**
   * The booking this form is working on: the one it was opened with, or the one
   * it has just created and is now correcting. Everything below asks this rather
   * than the prop, so a correction made from the verification card lands on the
   * saved booking instead of writing a second one beside it.
   */
  const target = booking ?? created

  // Going to 'free' from an active booking is either a checkout or a
  // cancellation; the API requires a reason to tell them apart.
  const ending = !!target && target.status !== 'free' && status === 'free'

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        guest_name: guestName,
        guest_phone: guestPhone || null,
        ...(hourly
          ? {}
          : {
              guest_citizenship:
                citizenship === 'other' ? otherCountry.trim() || null : citizenship || null,
              guest_document: document.trim() || null,
            }),
        date_from: toApi(dateFrom, hourly),
        date_to: toApi(dateTo, hourly),
        status,
        ...(ending ? { cancel_reason: cancelReason, cancel_note: cancelNote || null } : {}),
      }

      let saved: Booking
      if (target) {
        const result = await api<Booking & { waitlist_matches?: WaitlistEntry[] }>(
          `/bookings/${target.id}`,
          { method: 'PATCH', body: payload }
        )
        // Freeing dates is exactly when someone turned away should be called.
        if (ending && result.waitlist_matches && result.waitlist_matches.length > 0) {
          setMatches(result.waitlist_matches)
          onSaved()
          return
        }
        saved = result
        // Dates/status and money live on separate endpoints, so save money after.
        if (canSetPrice) {
          saved = await api<Booking>(`/bookings/${target.id}/payment`, {
            method: 'PATCH',
            body: {
              total_amount: Number(total || 0),
              prepaid_amount: Number(prepaid || 0),
              deposit_amount: Number(deposit || 0),
              ...(isBanquet
                ? {
                    guests_count: Number(guests || 0),
                    price_per_person: Number(perPerson || 0),
                  }
                : {}),
              currency,
            },
          })
        }
      } else {
        saved = await api<Booking>('/bookings', {
          method: 'POST',
          body: {
            ...payload,
            unit_id: unitId,
            ...(canSetPrice
              ? {
                  total_amount: Number(total || 0),
                  prepaid_amount: Number(prepaid || 0),
                  deposit_amount: Number(deposit || 0),
                  currency,
                  ...(Number(prepaid) > 0
                    ? {
                        payment_method: paymentMethod,
                        received_by: Number(receivedBy) || undefined,
                      }
                    : {}),
                }
              : {}),
          },
        })
      }
      onSaved()

      // A booking made here is read back before the form closes; one corrected
      // here is read back again, because a correction is exactly the moment a
      // second mistake gets in. Editing a booking that already existed keeps the
      // old behaviour — it was checked when it was made.
      if (!booking) {
        setCreated(saved)
        setFixing(false)
        return
      }
      onClose()
    } catch (err) {
      // 409 means the unit is taken for those dates — the one case where the
      // useful next step is the waitlist, not retyping the form.
      if (err instanceof ApiError && err.status === 409) setClash(true)
      setError(err instanceof Error ? err.message : 'Не удалось сохранить бронь')
    } finally {
      setSaving(false)
    }
  }

  async function addToWaitlist() {
    setSaving(true)
    setError(null)
    try {
      await api('/waitlist', {
        method: 'POST',
        body: {
          guest_name: guestName,
          guest_phone: guestPhone || null,
          unit_type: unitType,
          unit_id: unitId,
          date_from: toApi(dateFrom, hourly).slice(0, 10),
          date_to: toApi(dateTo, hourly).slice(0, 10),
        },
      })
      setWaitlisted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось добавить в лист ожидания')
    } finally {
      setSaving(false)
    }
  }

  if (matches.length > 0) {
    return (
      <Modal title="Даты освободились" onClose={onClose}>
        <div className="notice">
          Бронь завершена. Эти гости ждали именно эти даты — позвоните им.
        </div>
        <div className="stay-list">
          {matches.map((entry) => (
            <div className="stay-row" key={entry.id}>
              <div>
                <div className="stay-unit">{entry.guest_name}</div>
                <div className="stay-dates">
                  {entry.guest_phone ?? 'без телефона'} ·{' '}
                  {dateRange(entry.date_from, entry.date_to)}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="field-hint" style={{ marginTop: 12 }}>
          Отметить их как размещённых можно на странице «Ожидание».
        </div>
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={onClose}>
            Понятно
          </button>
        </div>
      </Modal>
    )
  }

  if (waitlisted) {
    return (
      <Modal title="Добавлено в лист ожидания" onClose={onClose}>
        <div className="notice">
          {guestName} записан(а) на {dateRange(dateFrom, dateTo)}. Когда даты освободятся,
          система напомнит об этой записи.
        </div>
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </Modal>
    )
  }

  // Saved, and now shown back for checking. The form is still mounted behind
  // this — «Исправить» returns to it with everything still typed in.
  if (created && !fixing) {
    return (
      <Modal title="Проверьте бронь" onClose={onClose}>
        <BookingVerifyCard
          booking={created}
          unitName={unitName}
          unitType={unitType}
          hourly={hourly}
          canSeeMoney={canSetPrice}
          paymentMethod={paymentMethod}
          receivedByName={
            staff.find((member) => String(member.id) === receivedBy)?.name ?? user?.name
          }
          onFix={() => setFixing(true)}
          onDone={onClose}
        />
      </Modal>
    )
  }

  return (
    <Modal title={target ? `Бронь #${target.id}` : 'Новая бронь'} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error && <Alert>{error}</Alert>}

        {clash && (
          <div className="notice notice-warn">
            Эти даты заняты. Записать гостя в лист ожидания — тогда при отмене брони
            система о нём напомнит.
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={addToWaitlist}
                disabled={saving || !guestName}
              >
                В лист ожидания
              </button>
            </div>
          </div>
        )}

        {/* A stay that starts on a Wednesday in the middle of a week reads as a
            typing mistake until the screen says why. This is the other half of
            переселение: the continuation has to admit what it continues, or the
            desk sees two unrelated bookings for one guest. */}
        {target?.moved_from_unit_name && (
          <div className="notice">
            Гость переселён из «{target.moved_from_unit_name}»
            {target.arrived_on && ` · заехал ${shortDate(target.arrived_on)}`}. Ночи до переезда
            остались за бронью #{target.moved_from_booking_id}.
          </div>
        )}

        <div className="field">
          <label htmlFor="guest">Гость</label>
          <input
            id="guest"
            value={guestName}
            onChange={(event) => setGuestName(event.target.value)}
            placeholder="Имя и фамилия"
            required
          />
        </div>

        <div className="field">
          <label htmlFor="guest-phone">Телефон гостя</label>
          <input
            id="guest-phone"
            type="tel"
            value={guestPhone ?? ''}
            onChange={(event) => setGuestPhone(event.target.value)}
            placeholder="+7 …"
          />
        </div>

        {/* Everything already known about this number, at the moment it is
            being written rather than after. A debt or a note about where not
            to put someone changes the booking; finding it out later does not.

            No gendered verb in the wording: a name does not tell you how to
            conjugate it, and «останавливался(ась)» is a worse answer than a
            noun. */}
        {known && (
          <div className={`notice ${known.outstanding_debt > 0 ? 'notice-warn' : ''}`}>
            <strong>{known.guest_name ?? 'Этот номер'}</strong> — не впервые у нас
            {known.total_stays > 0 && (
              <>
                {': '}
                {known.total_stays}{' '}
                {pluralRu(known.total_stays, ['заезд', 'заезда', 'заездов'])}
              </>
            )}
            {known.outstanding_debt > 0 && (
              <>
                {' · '}
                <strong>долг {money(known.outstanding_debt)}</strong>
              </>
            )}
            {known.notes && <div className="field-hint">Заметка: {known.notes}</div>}
          </div>
        )}

        <div className="field-row">
          <div className="field">
            <label htmlFor="from">{hourly ? 'Начало' : 'Заезд'}</label>
            <input
              id="from"
              type={hourly ? 'datetime-local' : 'date'}
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="to">{hourly ? 'Окончание' : 'Выезд'}</label>
            <input
              id="to"
              type={hourly ? 'datetime-local' : 'date'}
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              required
            />
          </div>
        </div>

        {/* Только для номеров: a gazebo for four hours is not accommodation and
            owes nobody a notice. Blank stays blank — see the state above. */}
        {!hourly && (
          <div className="field-row">
            <div className="field">
              <label htmlFor="citizenship">Гражданство</label>
              <select
                id="citizenship"
                value={
                  citizenship && !CITIZENSHIPS.some((item) => item.value === citizenship)
                    ? 'other'
                    : citizenship
                }
                onChange={(event) => {
                  setCitizenship(event.target.value)
                  if (event.target.value !== 'other') setOtherCountry('')
                }}
              >
                <option value="">— не указано —</option>
                {CITIZENSHIPS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
                <option value="other">Другая страна…</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="guest-document">Паспорт / удостоверение</label>
              <input
                id="guest-document"
                value={document}
                onChange={(event) => setDocument(event.target.value)}
                placeholder="номер"
              />
            </div>
          </div>
        )}

        {!hourly && citizenship === 'other' && (
          <div className="field">
            <label htmlFor="other-country">Какая страна</label>
            <input
              id="other-country"
              value={otherCountry}
              onChange={(event) => setOtherCountry(event.target.value)}
              placeholder="Германия"
            />
          </div>
        )}

        {/* Said once, where the decision is made, rather than left to be
            discovered on the Миграционный учёт page three days later. */}
        {!hourly && citizenship && citizenship !== KZ_CITIZENSHIP && (
          <div className="notice">
            Гость не из Казахстана — миграционную службу нужно уведомить в течение трёх дней
            после заезда. Срок и данные для подачи появятся в «Миграционном учёте».
          </div>
        )}

        <div className="field">
          <label htmlFor="status">Статус</label>
          <select
            id="status"
            value={status}
            onChange={(event) => setStatus(event.target.value as UnitStatus)}
          >
            <option value="booked">Забронирован</option>
            <option value="occupied">Заселён</option>
            <option value="free">Выехал / отменена</option>
          </select>
        </div>

        {ending && (
          <div className="cancel-block">
            <div className="field">
              <label htmlFor="cancel-reason">Причина завершения</label>
              <select
                id="cancel-reason"
                value={cancelReason}
                onChange={(event) => setCancelReason(event.target.value as CancelReason)}
              >
                {CANCEL_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {CANCEL_REASON_LABELS[reason]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="cancel-note">
                Комментарий{needsNote(cancelReason) ? '' : ' (необязательно)'}
              </label>
              <input
                id="cancel-note"
                value={cancelNote}
                onChange={(event) => setCancelNote(event.target.value)}
                placeholder={needsNote(cancelReason) ? 'Опишите причину' : ''}
                required={needsNote(cancelReason)}
              />
            </div>
          </div>
        )}

        {/* Событие: сколько человек и почём. Стоит перед суммой, потому что
            сумма из них и получается — и потому что «на сколько человек»
            спрашивают первым, ещё до цены. Число гостей нужно и официанту,
            который будет накрывать, поэтому оно не за `canSetPrice`. */}
        {isBanquet && (
          <div className="field-row">
            <div className="field">
              <label htmlFor="guests">Гостей</label>
              <input
                id="guests"
                type="number"
                min="1"
                max="100"
                value={guests}
                onChange={(event) => setGuests(event.target.value)}
                placeholder="40"
              />
              <div className="field-hint">Зона рассчитана до 100 человек.</div>
            </div>
            {canSetPrice && (
              <div className="field">
                <label htmlFor="per-person">Цена с человека</label>
                <input
                  id="per-person"
                  type="number"
                  min="0"
                  value={perPerson}
                  onChange={(event) => {
                    setPerPerson(event.target.value)
                    // Пересчёт, пока сумму не тронули руками: тронутая сумма —
                    // это то, о чём договорились с гостем, и её нельзя менять
                    // молча под ним.
                    if (!priceTouched) {
                      setTotal(String(Number(event.target.value || 0) * Number(guests || 0)))
                    }
                  }}
                  placeholder="17000"
                />
                <div className="field-hint">Банкетное меню — от 17 000 ₸.</div>
              </div>
            )}
          </div>
        )}

        {canSetPrice && (
          <>
            <div className="field-row">
              <div className="field">
                <label htmlFor="total">Сумма</label>
                <input
                  id="total"
                  type="number"
                  min="0"
                  value={total}
                  onChange={(event) => {
                    // From here on the figure belongs to whoever typed it: the
                    // price list never moves it again, however the dates change.
                    setPriceTouched(true)
                    setTotal(event.target.value)
                  }}
                  placeholder="0"
                />
              </div>
              <div className="field">
                <label htmlFor="prepaid">Предоплата</label>
                <input
                  id="prepaid"
                  type="number"
                  min="0"
                  value={prepaid}
                  onChange={(event) => setPrepaid(event.target.value)}
                  placeholder="0"
                />
              </div>
            </div>

            {isBanquet && Number(guests) > 0 && Number(perPerson) > 0 && (
              <div className="field-hint" style={{ marginTop: -8, marginBottom: 16 }}>
                {guests} × {money(Number(perPerson))} = {money(Number(guests) * Number(perPerson))}
                {priceTouched && Number(total) !== Number(guests) * Number(perPerson) && (
                  <>
                    {' — '}
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => {
                        setPriceTouched(false)
                        setTotal(String(Number(guests) * Number(perPerson)))
                      }}
                    >
                      вернуть расчёт
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Where the figure came from, in the terms the price list is
                written in — so a wrong amount is spotted here rather than on
                the invoice. Shown only when there is a list covering this
                stay; with none, the field behaves exactly as it always did. */}
            {quote && (
              <div className="field-hint" style={{ marginTop: -8, marginBottom: 16 }}>
                По прайсу{' '}
                {quote.nights.length === 1 && hourly
                  ? money(quote.nights[0].price)
                  : quote.nights
                      .map(
                        (night) =>
                          `${shortDate(night.date)} ${night.kind === 'weekend' ? 'вх' : 'бд'} ` +
                          `${money(night.price)}`
                      )
                      .join(' · ')}
                {quote.nights[0]?.season && ` · сезон «${quote.nights[0].season}»`}
                {priceTouched && Number(total) !== quote.total && (
                  <>
                    {' — '}
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => {
                        setPriceTouched(false)
                        setTotal(String(quote.total))
                      }}
                    >
                      вернуть {money(quote.total)}
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Only when there is money to account for. A prepayment lands in
                the ledger as a real payment, so it needs the same two answers
                every other payment needs — by what means, and into whose hands.
                Asking on a booking with no prepayment would be two empty fields
                on every screen for the sake of the occasional one.

                Gone once the booking exists, including while correcting one
                just made: the payment row is already written, and changing it
                is a correction that goes through the payment endpoint. Leaving
                the selectors up would offer a choice that no longer travels
                anywhere. */}
            {!target && Number(prepaid) > 0 && (
              <div className="field-row">
                <div className="field">
                  <label htmlFor="pay-method">Способ предоплаты</label>
                  <select
                    id="pay-method"
                    value={paymentMethod}
                    onChange={(event) => setPaymentMethod(event.target.value)}
                    required
                  >
                    <option value="" disabled>
                      Выберите способ
                    </option>
                    <option value="cash">Наличные</option>
                    <option value="card">Карта</option>
                    <option value="kaspi">Kaspi</option>
                    <option value="transfer">Перевод</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="pay-received-by">Кто принял</label>
                  <select
                    id="pay-received-by"
                    value={receivedBy}
                    onChange={(event) => setReceivedBy(event.target.value)}
                  >
                    {staff.length === 0 && user && <option value={user.id}>{user.name}</option>}
                    {staff.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
            <div className="field-row">
              <div className="field">
                <label htmlFor="deposit">Депозит / залог</label>
                <input
                  id="deposit"
                  type="number"
                  min="0"
                  value={deposit}
                  onChange={(event) => setDeposit(event.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="field">
                <label htmlFor="currency">Валюта</label>
                <select
                  id="currency"
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value as Currency)}
                >
                  {CURRENCIES.map((code) => (
                    <option key={code} value={code}>
                      {CURRENCY_LABELS[code]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </form>
    </Modal>
  )
}