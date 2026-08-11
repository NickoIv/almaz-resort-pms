import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLiveData } from '../useLiveData'
import { Link } from 'react-router-dom'
import { api } from '../api'
import MountainRidge from '../components/MountainRidge'
import { Alert, CountUp, Spinner, StatusDot } from '../components/ui'
import { describeAudit, type AuditEntry } from '../audit'
import { elapsedLabel, percent, todayIso } from '../format'
import type { CleaningOverview, CleaningUnit, Unit } from '../types'

type DigestPreview = { empty: boolean; sections: number; text: string }

type Loaded = {
  units: Unit[]
  cleaning: CleaningOverview
  waitlist: { open: number }
  audit: AuditEntry[]
  digest: DigestPreview | null
}

/** A booking touches "today" if its start or end date falls on it. */
function onDate(value: string | null | undefined, day: string): boolean {
  return !!value && value.slice(0, 10) === day
}

/**
 * The admin landing page.
 *
 * Deliberately read-only: every number is a link to the page that can act on
 * it, so this stays a place to look rather than a second, competing place to
 * work. Everything is derived from endpoints the other pages already call —
 * no new API surface to keep in step.
 */
export default function DashboardPage() {
  const [data, setData] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setError(null)
    Promise.all([
      api<Unit[]>('/units'),
      api<CleaningOverview>('/cleaning'),
      // Each tile degrades on its own: a failure here must not blank the page.
      api<{ open: number }>('/waitlist/summary').catch(() => ({ open: 0 })),
      api<{ entries: AuditEntry[] }>('/audit?limit=6')
        .then((r) => r.entries)
        .catch(() => []),
      // What today's WhatsApp/Telegram digest would say. It belongs here
      // rather than under Settings: it reports the state of the day, it does
      // not configure anything.
      api<DigestPreview>('/settings/preview').catch(() => null),
    ])
      .then(([units, cleaning, waitlist, audit, digest]) =>
        setData({ units, cleaning, waitlist, audit, digest })
      )
      .catch((err) => setError(err instanceof Error ? err.message : 'Ошибка загрузки'))
  }, [])

  useEffect(load, [load])
  // The summary is a claim about right now; old data on it is a wrong claim.
  // No spinner to guard — the previous figures stay up until new ones land.
  useLiveData(load, { poll: true })

  const today = todayIso()

  const stats = useMemo(() => {
    if (!data) return null
    const rooms = data.units.filter((unit) => unit.type === 'room')
    const busy = rooms.filter((unit) => unit.status === 'occupied').length
    const booked = rooms.filter((unit) => unit.status === 'booked').length

    // Both the current and the next booking are checked: an arrival later
    // today sits in next_booking until the guest is actually checked in.
    const bookings = data.units.flatMap((unit) =>
      [unit.current_booking, unit.next_booking].filter((b) => b !== null)
    )

    return {
      rooms: rooms.length,
      busy,
      booked,
      rate: rooms.length > 0 ? busy / rooms.length : 0,
      arrivals: bookings.filter((b) => onDate(b.date_from, today)).length,
      departures: bookings.filter((b) => onDate(b.date_to, today)).length,
      overdue: data.cleaning.units.filter((unit) => unit.is_overdue).length,
    }
  }, [data, today])

  if (error) return <Alert>{error}</Alert>
  if (!data || !stats) return <Spinner />

  const waiting: CleaningUnit[] = data.cleaning.units

  return (
    <>
      <div className="page-head has-ridge">
        {/* Fainter than on the login screen, but a horizon the eye can
            actually find: the ridge is the one piece of the place itself in
            the interface, and there is no point drawing it at an opacity that
            makes it indistinguishable from the page. */}
        <MountainRidge className="ridge-dashboard" fit="slice" />
        <div>
          <h1>Сводка</h1>
          <div className="page-sub">Положение дел на {today}</div>
        </div>
        <div className="page-head-actions">
          <button className="btn btn-sm" onClick={() => load()}>
            Обновить
          </button>
        </div>
      </div>

      <div className="tile-grid">
        <Link className="tile glass" to="/rooms">
          <div className="tile-label">Занято номеров</div>
          <div className="tile-value">
            <CountUp value={stats.busy} />
            <span className="tile-of">из {stats.rooms}</span>
          </div>
          <div className="meter">
            <div className="meter-fill" style={{ width: percent(stats.rate) }} />
          </div>
          <div className="tile-foot">
            {percent(stats.rate)} загрузки · {stats.booked} забронировано
          </div>
        </Link>

        <Link className="tile glass" to="/cleaning">
          <div className="tile-label">Требуют уборки</div>
          <div className="tile-value">
            <CountUp value={waiting.length} />
          </div>
          <div className="tile-foot">
            {stats.overdue > 0 ? (
              <span className="sla-over">
                {stats.overdue} дольше {data.cleaning.sla_minutes} мин
              </span>
            ) : (
              'всё в пределах норматива'
            )}
          </div>
        </Link>

        {/* Led to the board until «Сегодня» existed, where three arrivals had
            to be found by reading down a column of fourteen rooms. */}
        <Link className="tile glass" to="/today">
          <div className="tile-label">Заезды сегодня</div>
          <div className="tile-value">
            <CountUp value={stats.arrivals} />
          </div>
          <div className="tile-foot">выездов: {stats.departures}</div>
        </Link>

        <Link className="tile glass" to="/waitlist">
          <div className="tile-label">Лист ожидания</div>
          <div className="tile-value">
            <CountUp value={data.waitlist.open} />
          </div>
          <div className="tile-foot">
            {data.waitlist.open > 0 ? 'ждут свободных дат' : 'никто не ждёт'}
          </div>
        </Link>
      </div>

      <div className="dash-grid">
        <section className="panel glass">
          <div className="panel-title">
            <StatusDot status="cleaning" />
            Ждут уборки
            <span className="count">
              <Link to="/cleaning">все →</Link>
            </span>
          </div>

          {waiting.length === 0 ? (
            <div className="dash-empty">Все объекты чистые.</div>
          ) : (
            <div className="row-list">
              {waiting.slice(0, 6).map((unit) => (
                <div className={`row-card ${unit.is_overdue ? 'is-overdue' : ''}`} key={unit.id}>
                  <div className="row-main">
                    <div className="row-title">{unit.name}</div>
                    <div className="row-sub">
                      {unit.category ?? '—'} · осталось {unit.pending} из {unit.total}
                    </div>
                  </div>
                  <span className={`sla ${unit.is_overdue ? 'sla-over' : ''}`}>
                    {elapsedLabel(unit.waiting_minutes)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel glass">
          <div className="panel-title">
            Сводка для рассылки
            <span className="count">
              <Link to="/settings">каналы →</Link>
            </span>
          </div>

          {data.digest === null ? (
            <div className="dash-empty">Предпросмотр недоступен.</div>
          ) : data.digest.empty ? (
            <div className="dash-empty">
              Сейчас сообщать не о чем — заездов, выездов, просроченной уборки и долгов нет.
            </div>
          ) : (
            // The API returns plain text already; there is no markup to strip.
            <pre className="digest-preview">{data.digest.text}</pre>
          )}
        </section>

        <section className="panel glass">
          <div className="panel-title">
            Последние действия
            <span className="count">
              <Link to="/audit">журнал →</Link>
            </span>
          </div>

          {data.audit.length === 0 ? (
            <div className="dash-empty">Записей пока нет.</div>
          ) : (
            <div className="row-list">
              {data.audit.map((entry) => (
                <div className="row-card" key={entry.id}>
                  <div className="row-main">
                    <div className="row-title">{describeAudit(entry)}</div>
                    <div className="row-sub">
                      {entry.staff_name ?? '—'}
                      {entry.target ? ` · ${entry.target}` : ''}
                    </div>
                  </div>
                  <span className="row-when">
                    {entry.created_at.replace('T', ' ').slice(5, 16)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  )
}
