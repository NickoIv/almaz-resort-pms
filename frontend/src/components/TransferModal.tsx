import { useEffect, useState } from 'react'
import { api } from '../api'
import { Alert, Modal, Spinner } from './ui'
import { dateRange, money, pluralRu, shortDate } from '../format'
import type { Booking, TransferPlan, TransferResult } from '../types'

type Props = {
  booking: Booking
  /** The unit the guest is in now — named, because an id proves nothing to a person. */
  unitName: string
  canSetPrice: boolean
  onClose: () => void
  /** Called once the move is written, so the page behind can catch up. */
  onSaved: () => void
}

/**
 * Переселение — moving a guest to another unit without cancelling their stay.
 *
 * Until this existed the only way to move somebody was to cancel the booking and
 * write a new one, which threw away the payments, the extra charges, the
 * verification stamp, the group, the migration notice and the guest's history —
 * every fact about the stay except the one that changed.
 *
 * The dialog's job is to make the consequence visible **before** it happens.
 * The server decides the shape of the move from the dates (see
 * backend/src/lib/transfer.ts), so this asks it first and reports what it said:
 * whether the stay moves whole or splits at today, which units are actually
 * free for the remaining nights, and what each leg will be billed. A room move
 * changes where money sits, and money that moves without being shown first is
 * how a desk stops trusting a screen.
 */
export default function TransferModal({
  booking,
  unitName,
  canSetPrice,
  onClose,
  onSaved,
}: Props) {
  const [plan, setPlan] = useState<TransferPlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [target, setTarget] = useState<number | null>(null)
  const [stayAmount, setStayAmount] = useState('')
  const [moveAmount, setMoveAmount] = useState('')
  /** Set once a person types a figure: the price list never moves it again. */
  const [priceTouched, setPriceTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState<TransferResult | null>(null)

  useEffect(() => {
    let abandoned = false
    api<TransferPlan>(`/bookings/${booking.id}/transfer-targets`)
      .then((result) => {
        if (abandoned) return
        setPlan(result)
        setStayAmount(String(result.suggested_stay_amount ?? ''))
        setMoveAmount(String(result.suggested_move_amount ?? ''))
      })
      .catch((err) => {
        if (!abandoned) setError(err instanceof Error ? err.message : 'Не удалось открыть переселение')
      })
      .finally(() => {
        if (!abandoned) setLoading(false)
      })
    return () => {
      abandoned = true
    }
  }, [booking.id])

  const chosen = plan?.units.find((unit) => unit.id === target) ?? null

  // The price list's answer for the unit actually being considered — the reason
  // rooms are worth choosing between is that they do not all cost the same.
  const quoted = chosen?.quote ?? null

  useEffect(() => {
    if (quoted === null || priceTouched) return
    setMoveAmount(String(quoted))
  }, [quoted, priceTouched])

  async function submit() {
    if (!target) return
    setSaving(true)
    setError(null)
    try {
      const result = await api<TransferResult>(`/bookings/${booking.id}/transfer`, {
        method: 'POST',
        body: {
          to_unit_id: target,
          ...(canSetPrice && plan?.mode === 'split'
            ? { stay_amount: Number(stayAmount || 0), move_amount: Number(moveAmount || 0) }
            : canSetPrice && moveAmount !== ''
              ? { move_amount: Number(moveAmount) }
              : {}),
        },
      })
      onSaved()
      setDone(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось переселить')
    } finally {
      setSaving(false)
    }
  }

  if (done) {
    const split = done.mode === 'split'
    return (
      <Modal title="Гость переселён" onClose={onClose}>
        <div className="notice">
          <strong>{booking.guest_name ?? 'Гость'}</strong> — из «{done.from_unit.name}» в «
          {done.to_unit.name}».{' '}
          {split
            ? `Ночи до ${shortDate(done.split_on!)} остались за «${done.from_unit.name}», ` +
              `остальные — за «${done.to_unit.name}». Это одна и та же поездка: ` +
              'оплаты, начисления и история гостя никуда не делись.'
            : 'Бронь та же самая — тот же номер брони, те же оплаты и начисления.'}
        </div>

        {canSetPrice && (
          <div className="pay-rows" style={{ marginTop: 16 }}>
            {split && done.previous && (
              <div className="pay-row">
                <span>
                  «{done.from_unit.name}» · бронь #{done.previous.id}
                </span>
                <span>{money(done.previous.total_amount ?? 0, done.previous.currency)}</span>
              </div>
            )}
            <div className="pay-row">
              <span>
                «{done.to_unit.name}» · бронь #{done.booking.id}
              </span>
              <span>{money(done.booking.total_amount ?? 0, done.booking.currency)}</span>
            </div>
            <div className="pay-row total">
              <span>Остаток по текущей брони</span>
              <span className={(done.booking.remaining_amount ?? 0) > 0 ? 'money-due' : ''}>
                {money(done.booking.remaining_amount ?? 0, done.booking.currency)}
              </span>
            </div>
          </div>
        )}

        {split && (done.carried_amount ?? 0) > 0 && (
          <div className="field-hint" style={{ marginTop: 12 }}>
            {money(done.carried_amount ?? 0, done.booking.currency)} предоплаты перенесено на новую
            бронь — гость платил один раз и платить снова не должен.
          </div>
        )}
        {split && done.previous && (done.previous.remaining_amount ?? 0) > 0 && (
          <div className="notice notice-warn" style={{ marginTop: 12 }}>
            За прожитые ночи в «{done.from_unit.name}» осталось{' '}
            {money(done.previous.remaining_amount ?? 0, done.previous.currency)} — этот долг
            числится за бронью #{done.previous.id}, а не за новой.
          </div>
        )}
        {split && (
          <div className="field-hint" style={{ marginTop: 12 }}>
            «{done.from_unit.name}» отправлен на уборку.
          </div>
        )}

        <div className="modal-actions">
          <button className="btn btn-primary" onClick={onClose}>
            Понятно
          </button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title={`Переселить · ${unitName}`} onClose={onClose}>
      {error && <Alert>{error}</Alert>}
      {loading && <Spinner />}

      {plan && (
        <>
          {/* What the move will actually do. The shape follows from the dates,
              not from a choice on this screen, so it is stated rather than
              offered — a switch here would only be a way to record nights in a
              room nobody slept in. */}
          <div className="notice">
            {plan.mode === 'whole' ? (
              <>
                Гость ещё не заехал в «{plan.from_unit.name}» — бронь целиком переедет в другой
                объект. Номер брони, оплаты, начисления и проверка останутся те же.
              </>
            ) : (
              <>
                Гость уже живёт в «{plan.from_unit.name}»:{' '}
                {plan.nights_before} {pluralRu(plan.nights_before, ['ночь', 'ночи', 'ночей'])}{' '}
                прожито. С {shortDate(plan.split_on!)} оставшиеся {plan.nights_after}{' '}
                {pluralRu(plan.nights_after, ['ночь', 'ночи', 'ночей'])} перейдут в новый объект
                отдельной бронью — она будет связана с этой, чтобы заезд остался одним.
              </>
            )}
          </div>

          <div className="panel-title" style={{ marginTop: 20 }}>
            Куда переселить
            <span className="count">
              {dateRange(plan.moved_from, plan.date_to)}
            </span>
          </div>

          {plan.units.length === 0 ? (
            <div className="dash-empty">Других объектов такого типа нет.</div>
          ) : (
            <div className="stay-list transfer-list">
              {plan.units.map((unit) => (
                <button
                  type="button"
                  key={unit.id}
                  className={`stay-row transfer-option ${target === unit.id ? 'is-picked' : ''}`}
                  disabled={!unit.free}
                  onClick={() => setTarget(unit.id)}
                >
                  <div>
                    <div className="stay-unit">{unit.name}</div>
                    <div className="stay-dates">
                      {unit.category ?? '—'} · до {unit.capacity} чел.
                      {unit.needs_cleaning && ' · не убран'}
                    </div>
                  </div>
                  <div className="stay-money">
                    {/* Why a unit cannot be picked, not merely that it cannot.
                        "Where can I put this guest" and "why not 105" are two
                        questions, and the second is the one asked out loud. */}
                    {unit.free
                      ? unit.quote != null
                        ? money(unit.quote, plan.currency)
                        : ''
                      : <span className="stay-status">занят: {unit.taken_by}</span>}
                  </div>
                </button>
              ))}
            </div>
          )}

          {canSetPrice && chosen && (
            <>
              <div className="panel-title" style={{ marginTop: 20 }}>
                Суммы
              </div>
              {plan.mode === 'split' && (
                <div className="field">
                  <label htmlFor="stay-amount">
                    За прожитое в «{plan.from_unit.name}» ({plan.nights_before}{' '}
                    {pluralRu(plan.nights_before, ['ночь', 'ночи', 'ночей'])})
                  </label>
                  <input
                    id="stay-amount"
                    type="number"
                    min="0"
                    value={stayAmount}
                    onChange={(event) => setStayAmount(event.target.value)}
                  />
                </div>
              )}
              <div className="field">
                <label htmlFor="move-amount">
                  За «{chosen.name}»
                  {plan.mode === 'split' && (
                    <>
                      {' '}
                      ({plan.nights_after}{' '}
                      {pluralRu(plan.nights_after, ['ночь', 'ночи', 'ночей'])})
                    </>
                  )}
                </label>
                <input
                  id="move-amount"
                  type="number"
                  min="0"
                  value={moveAmount}
                  onChange={(event) => {
                    setPriceTouched(true)
                    setMoveAmount(event.target.value)
                  }}
                />
              </div>

              {/* By default the agreed price is divided pro rata by night, so
                  the guest's bill does not change because the hotel moved them.
                  A dearer room has to be re-quoted, and only a person can decide
                  whether the guest is being asked to pay for that. */}
              <div className="field-hint" style={{ marginTop: -8 }}>
                {plan.mode === 'split' ? (
                  <>
                    По умолчанию {money(plan.total_amount ?? 0, plan.currency)} делятся по ночам:{' '}
                    {money(plan.suggested_stay_amount ?? 0, plan.currency)} +{' '}
                    {money(plan.suggested_move_amount ?? 0, plan.currency)}. Итог для гостя тогда не
                    меняется.
                  </>
                ) : (
                  <>Сейчас в брони {money(plan.total_amount ?? 0, plan.currency)}.</>
                )}
                {quoted != null && Number(moveAmount) !== quoted && (
                  <>
                    {' — '}
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => {
                        setPriceTouched(false)
                        setMoveAmount(String(quoted))
                      }}
                    >
                      по прайсу {money(quoted, plan.currency)}
                    </button>
                  </>
                )}
              </div>
            </>
          )}

          <div className="modal-actions transfer-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Отмена
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={submit}
              disabled={saving || !target}
            >
              {saving ? 'Переселяем…' : 'Переселить'}
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}
