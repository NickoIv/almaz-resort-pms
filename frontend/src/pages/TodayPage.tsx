import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import { useLiveData } from '../useLiveData'
import PaymentModal from '../components/PaymentModal'
import DepositModal from '../components/DepositModal'
import { Alert, EmptyState, Spinner, StatusBadge } from '../components/ui'
import { blockReasonWord } from '../blocks'
import { dateRange, money, pluralRu, shortDate, timeRange } from '../format'
import type { TodayBoard, TodayRow } from '../types'

/**
 * «Сегодня» — кто заезжает, кто выезжает.
 *
 * The most-asked question at a front desk, and the app used to answer it with a
 * number: a tile saying «Заезды сегодня 3» that led to the planning board,
 * where the three had to be found by reading down a column of fourteen rooms.
 *
 * Two lists, and they are on one screen because they are one shift. A departure
 * is the moment money changes hands and a key comes back; an arrival is the
 * moment a passport is on the desk and the room has to be clean. The things
 * that can go wrong at each are said **on the row**, before the button — a
 * warning discovered after check-in is a warning that arrived too late.
 */
export default function TodayPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [data, setData] = useState<TodayBoard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  /** Set when a departure still owes: the balance is settled before the key. */
  const [collecting, setCollecting] = useState<TodayRow | null>(null)
  /** And then the hold goes back, which is the other thing a checkout owes. */
  const [returning, setReturning] = useState<TodayRow | null>(null)

  const load = useCallback(async (background = false) => {
    if (!background) setLoading(true)
    try {
      setData(await api<TodayBoard>('/today'))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [])

  // `useLiveData` only *re*-asks — on a write, on focus, on an interval. The
  // first fetch is still the page's own job, and forgetting it leaves the
  // spinner up for ever, which is exactly what happened here until a browser
  // probe opened the page and found nothing on it.
  useEffect(() => {
    void load()
  }, [load])

  // A shared screen in a hotel worked by three people: it polls, and every
  // refresh is a background one — a spinner over a list somebody is working
  // through is worse than the staleness it cures.
  useLiveData(load, { poll: true })

  async function checkIn(row: TodayRow) {
    setBusy(row.booking_id)
    setError(null)
    try {
      await api(`/bookings/${row.booking_id}`, { method: 'PATCH', body: { status: 'occupied' } })
      await load(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось заселить')
    } finally {
      setBusy(null)
    }
  }

  /**
   * A checkout owes the guest two things and the hotel one, in this order:
   * take what is owed, hand the hold back, then close the booking. Doing them
   * in any other order is how a guest drives off with the hotel's money or
   * without their own — and both are discovered at the end of the shift.
   */
  async function checkOut(row: TodayRow) {
    if ((row.remaining_amount ?? 0) > 0) {
      setCollecting(row)
      return
    }
    if (row.deposit_pending) {
      setReturning(row)
      return
    }
    setBusy(row.booking_id)
    setError(null)
    try {
      await api(`/bookings/${row.booking_id}`, {
        method: 'PATCH',
        body: { status: 'free', cancel_reason: 'checked_out' },
      })
      await load(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось выселить')
    } finally {
      setBusy(null)
    }
  }

  if (loading) return <Spinner />
  if (error && !data) return <Alert>{error}</Alert>
  if (!data) return null

  const hourly = (row: TodayRow) => row.unit_type !== 'room'

  /** One row of either list — the same shape, so the eye does not relearn it. */
  const Row = ({ row, kind }: { row: TodayRow; kind: 'in' | 'out' }) => (
    <div className={`row-card ${row.needs_cleaning && kind === 'in' ? 'is-overdue' : ''}`}>
      <div className="row-main">
        <div className="row-title">
          <Link to={`/rooms/${row.unit_id}`}>{row.unit_name}</Link> · {row.guest_name}
        </div>
        <div className="row-sub">
          {hourly(row)
            ? timeRange(row.date_from, row.date_to)
            : `${dateRange(row.date_from, row.date_to)} · ${row.nights} ${pluralRu(row.nights, [
                'ночь',
                'ночи',
                'ночей',
              ])}`}
        </div>

        {/* Everything that has to be dealt with before the button is pressed,
            said here rather than discovered afterwards. */}
        <div className="today-flags">
          <StatusBadge status={row.status} />
          {/* A phone number at a desk exists to be dialled, so it is a tap
              target and not a run of characters inside a caption: inline in the
              subtitle it measured 16px tall against the app's 40px floor. */}
          {row.guest_phone && (
            <a className="today-phone" href={`tel:${row.guest_phone.replace(/\s/g, '')}`}>
              {row.guest_phone}
            </a>
          )}
          {kind === 'in' && row.needs_cleaning && (
            <StatusBadge status="cleaning" label={`не убран · ${row.cleaning_pending}`} />
          )}
          {row.migration_due && (
            <span className="pill pill-due" title="Уведомить миграционную службу в течение трёх дней с заезда">
              миграционный учёт
            </span>
          )}
          {kind === 'in' && !row.verified_at && (
            <span className="pill" title="Бронь никто не сверил с тем, что просил гость">
              не проверена
            </span>
          )}
        </div>
      </div>

      <div className="row-money">
        {isAdmin && (
          <span className={(row.remaining_amount ?? 0) > 0 ? 'money-due' : 'money'}>
            {(row.remaining_amount ?? 0) > 0
              ? `долг ${money(row.remaining_amount, row.currency)}`
              : 'оплачено'}
          </span>
        )}
        {!isAdmin && (
          <span className={`pill ${row.is_paid ? 'pill-paid' : 'pill-due'}`}>
            {row.is_paid ? 'оплачено' : 'не оплачено'}
          </span>
        )}
        {isAdmin && kind === 'out' && row.deposit_pending && (
          <span className="field-hint">залог {money(row.deposit_amount, row.currency)} — вернуть</span>
        )}
      </div>

      <button
        className="btn btn-sm btn-primary"
        disabled={busy === row.booking_id || (kind === 'in' && row.status === 'occupied')}
        onClick={() => (kind === 'in' ? checkIn(row) : checkOut(row))}
      >
        {busy === row.booking_id
          ? '…'
          : kind === 'in'
            ? row.status === 'occupied'
              ? 'Заселён'
              : 'Заселить'
            : 'Выселить'}
      </button>
    </div>
  )

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Сегодня</h1>
          <div className="page-sub">
            {shortDate(data.today)} · заездов {data.arrivals.length} · выездов{' '}
            {data.departures.length} · проживают {data.staying}
          </div>
        </div>
        <div className="page-head-actions">
          <button className="btn btn-sm" onClick={() => load()}>
            Обновить
          </button>
        </div>
      </div>

      {error && <Alert>{error}</Alert>}

      {/* Off sale today. Part of «что у нас сегодня», and the desk should not
          have to discover it by trying to sell it. */}
      {data.blocked.length > 0 && (
        <div className="notice notice-warn">
          <strong>Сняты с продажи:</strong>{' '}
          {data.blocked
            .map(
              (block) =>
                `${block.unit_name} (${blockReasonWord(block.reason)}, до ${shortDate(
                  block.date_to
                )})`
            )
            .join(' · ')}
        </div>
      )}

      <div className="detail-grid">
        <section className="panel glass">
          <div className="panel-title">
            Заезды
            <span className="count">{data.arrivals.length}</span>
          </div>
          {data.arrivals.length === 0 ? (
            <div className="dash-empty">Сегодня никто не заезжает.</div>
          ) : (
            <div className="row-list">
              {data.arrivals.map((row) => (
                <Row key={row.booking_id} row={row} kind="in" />
              ))}
            </div>
          )}
        </section>

        <section className="panel glass">
          <div className="panel-title">
            Выезды
            <span className="count">{data.departures.length}</span>
          </div>
          {data.departures.length === 0 ? (
            <div className="dash-empty">Сегодня никто не выезжает.</div>
          ) : (
            <div className="row-list">
              {data.departures.map((row) => (
                <Row key={row.booking_id} row={row} kind="out" />
              ))}
            </div>
          )}
        </section>
      </div>

      {data.arrivals.length === 0 && data.departures.length === 0 && (
        <EmptyState icon="☕">
          Спокойный день: ни заездов, ни выездов. Проживают {data.staying}.
        </EmptyState>
      )}

      {/* Owed money is collected before the key comes back, not after. The
          ordinary payment dialog — nothing special had to be invented, it just
          had to be reachable from the moment the question is asked. */}
      {collecting && (
        <PaymentModal
          bookingId={collecting.booking_id}
          onClose={() => setCollecting(null)}
          onSaved={() => void load(true)}
        />
      )}

      {/* The hold goes back before the booking closes: after it, the row is off
          this screen and the money is somebody's problem tomorrow. */}
      {returning && (
        <DepositModal
          booking={{
            id: returning.booking_id,
            guest_name: returning.guest_name,
            date_from: returning.date_from,
            date_to: returning.date_to,
            deposit_amount: returning.deposit_amount,
            currency: returning.currency,
          }}
          onClose={() => setReturning(null)}
          onSaved={() => void load(true)}
        />
      )}
    </>
  )
}
