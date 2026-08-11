import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { Alert, EmptyState, Spinner, StatusBadge } from '../components/ui'
import { downloadCsv } from '../csv'
import { dateRange, todayIso } from '../format'
import type { MigrationEntry, MigrationRegister } from '../types'

/**
 * Миграционный учёт.
 *
 * Kazakhstan puts the duty on the receiving party: three days from a foreign
 * guest's arrival to notify the migration service through eQonaq or the
 * visa-migration portal, with a fine for missing it. The app cannot submit —
 * that needs the hotel's ЭЦП — so this does the parts that actually go wrong:
 * **counting the days**, and having the five fields the notice asks for ready
 * to copy in one place.
 *
 * Three lists, and the middle one is the point of the screen. «Нужно
 * уведомить» is the obligation. «Гражданство не указано» is the arrivals
 * nobody has classified — not treated as foreign, because most guests here are
 * Kazakh and a false deadline on nine bookings in ten would train everyone to
 * ignore this page, but shown, so that a foreign guest cannot be missed through
 * silence. «Уже поданы» is the record, for when somebody asks later.
 */
export default function MigrationPage() {
  const [data, setData] = useState<MigrationRegister | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setError(null)
    api<MigrationRegister>('/migration')
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Ошибка загрузки'))
  }, [])

  useEffect(load, [load])

  async function markFiled(entry: MigrationEntry) {
    setBusy(entry.booking_id)
    setError(null)
    try {
      await api(`/migration/${entry.booking_id}/filed`, { method: 'POST' })
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отметить')
    } finally {
      setBusy(null)
    }
  }

  function exportCsv() {
    if (!data) return
    downloadCsv(`taura-pms-migration-${todayIso()}.csv`, [
      ['Миграционный учёт иностранных гостей'],
      ['Принимающая сторона', data.hotel_name],
      ['Адрес пребывания', data.hotel_address],
      [],
      ['Гость', 'Гражданство', 'Документ', 'Заезд', 'Выезд', 'Объект', 'Срок подачи', 'Подано'],
      ...[...data.due, ...data.filed].map((row) => [
        row.guest_name,
        row.guest_citizenship ?? '',
        row.guest_document ?? '',
        row.date_from.slice(0, 10),
        row.date_to.slice(0, 10),
        row.unit_name,
        row.due_on ?? '',
        row.migration_notified_at ?? 'нет',
      ]),
    ])
  }

  if (error && !data) return <Alert>{error}</Alert>
  if (!data) return <Spinner />

  /** Late, today, or still in hand — said in words rather than in a number. */
  const deadline = (row: MigrationEntry) => {
    const left = row.days_left ?? 0
    if (left < 0) return { text: `просрочено на ${-left} дн.`, late: true }
    if (left === 0) return { text: 'сегодня последний день', late: true }
    return { text: `осталось ${left} дн. (до ${row.due_on})`, late: false }
  }

  const row = (entry: MigrationEntry, right: React.ReactNode) => (
    <div className="row-card" key={entry.booking_id}>
      <div className="row-main">
        <div className="row-title">
          {entry.guest_name}
          {entry.guest_citizenship && <span className="tag">{entry.guest_citizenship}</span>}
        </div>
        <div className="row-sub">
          <Link to={`/rooms/${entry.unit_id}`}>{entry.unit_name}</Link> ·{' '}
          {dateRange(entry.date_from, entry.date_to)}
          {entry.guest_document && ` · ${entry.guest_document}`}
          {entry.guest_phone && ` · ${entry.guest_phone}`}
        </div>
      </div>
      {right}
    </div>
  )

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Миграционный учёт</h1>
          <div className="page-sub">
            Иностранного гостя нужно зарегистрировать в течение {data.notice_days} дней после
            заезда — через eQonaq или портал vmp.gov.kz
          </div>
        </div>
        <div className="page-head-actions">
          <button className="btn btn-sm" onClick={exportCsv} disabled={!data.due.length && !data.filed.length}>
            Экспорт CSV
          </button>
          <button className="btn btn-sm" onClick={load}>
            Обновить
          </button>
        </div>
      </div>

      {error && <Alert>{error}</Alert>}

      {/* The notice asks for the receiving party and the address of stay every
          time, and both are the hotel's own — so they sit here to be copied
          rather than remembered. */}
      <div className="notice">
        <strong>Принимающая сторона:</strong> {data.hotel_name || '— не заполнено в Настройках —'}
        {' · '}
        <strong>адрес пребывания:</strong>{' '}
        {data.hotel_address || '— не заполнено в Настройках —'}
        <div className="field-hint" style={{ marginTop: 8 }}>
          Подаёт человек: для отправки нужна ЭЦП принимающей стороны, приложение сделать это за
          вас не может. Здесь — срок и все данные для формы.
        </div>
      </div>

      <section className="panel glass" style={{ marginBottom: 16 }}>
        <div className="panel-title">
          Нужно уведомить
          <span className="count">{data.due.length}</span>
        </div>
        {data.due.length === 0 ? (
          <div className="field-hint">Никого — все иностранные гости зарегистрированы.</div>
        ) : (
          <div className="row-list">
            {data.due.map((entry) => {
              const state = deadline(entry)
              return row(
                entry,
                <div className="row-actions">
                  <span className={state.late ? 'sla-over' : 'sla'}>{state.text}</span>
                  <button
                    className="btn btn-sm btn-primary"
                    disabled={busy === entry.booking_id}
                    onClick={() => void markFiled(entry)}
                  >
                    {busy === entry.booking_id ? 'Отмечаем…' : 'Уведомление подано'}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {data.unknown.length > 0 && (
        <section className="panel glass" style={{ marginBottom: 16 }}>
          <div className="panel-title">
            Гражданство не указано
            <span className="count">{data.unknown.length}</span>
          </div>
          <div className="field-hint" style={{ marginBottom: 12 }}>
            Эти гости уже заехали, но никто не отметил, откуда они. Казахстанцев ставить на учёт
            не нужно — отметьте страну в брони, и они отсюда исчезнут.
          </div>
          <div className="row-list">
            {data.unknown.map((entry) =>
              row(
                entry,
                <div className="row-actions">
                  <Link className="btn btn-sm" to={`/rooms/${entry.unit_id}`}>
                    Открыть объект
                  </Link>
                </div>
              )
            )}
          </div>
        </section>
      )}

      <section className="panel glass">
        <div className="panel-title">
          Уже поданы
          <span className="count">{data.filed.length}</span>
        </div>
        {data.filed.length === 0 ? (
          <EmptyState icon="🗂">Пока ничего не подавали.</EmptyState>
        ) : (
          <div className="row-list">
            {data.filed.map((entry) =>
              row(
                entry,
                <span className="row-when">
                  <StatusBadge status="free" label="подано" />
                  {entry.migration_notified_at?.slice(0, 16)}
                  {entry.migration_notified_by_name && ` · ${entry.migration_notified_by_name}`}
                </span>
              )
            )}
          </div>
        )}
      </section>
    </>
  )
}
