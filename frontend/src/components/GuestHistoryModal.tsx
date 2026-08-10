import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import GuestSheet from './GuestSheet'
import { Alert, Modal, Spinner } from './ui'
import { dateRange, money } from '../format'
import { STATUS_LABELS, type GuestHistory } from '../types'

/**
 * Everything known about a returning guest, keyed by phone — that is the one
 * field that stays stable while names get retyped differently each visit.
 */
export default function GuestHistoryModal({
  phone,
  onClose,
}: {
  phone: string
  onClose: () => void
}) {
  const [data, setData] = useState<GuestHistory | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  const [savedAt, setSavedAt] = useState(false)
  const [showSheet, setShowSheet] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    api<GuestHistory>(`/guests/${encodeURIComponent(phone)}`)
      .then((result) => {
        setData(result)
        setNotes(result.notes)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Ошибка загрузки'))
      .finally(() => setLoading(false))
  }, [phone])

  useEffect(load, [load])

  async function saveNotes() {
    setSavingNotes(true)
    setSavedAt(false)
    try {
      await api(`/guests/${encodeURIComponent(phone)}/notes`, {
        method: 'PUT',
        body: { notes },
      })
      // Kept in step with the textarea so the printed sheet shows what is
      // actually recorded — and, equally, so unsaved typing never prints as if
      // it were.
      setData((prev) => (prev ? { ...prev, notes } : prev))
      setSavedAt(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить')
    } finally {
      setSavingNotes(false)
    }
  }

  return (
    <Modal title="История гостя" onClose={onClose}>
      {loading ? (
        <Spinner />
      ) : error ? (
        <Alert>{error}</Alert>
      ) : data ? (
        <>
          <div className="guest-head">
            <div className="guest-name">{data.guest_name ?? 'Неизвестный гость'}</div>
            <div className="guest-phone">{data.phone}</div>
            <button
              type="button"
              className="btn btn-sm card-action"
              onClick={() => setShowSheet(true)}
            >
              Печать карты гостя
            </button>
          </div>

          <div className="mini-stats">
            <div className="mini-stat">
              <div className="mini-stat-value">{data.total_stays}</div>
              <div className="mini-stat-label">всего броней</div>
            </div>
            <div className="mini-stat">
              <div className="mini-stat-value">{data.past_stays}</div>
              <div className="mini-stat-label">завершено</div>
            </div>
            <div className="mini-stat">
              <div className={`mini-stat-value ${data.outstanding_debt > 0 ? 'money-due' : ''}`}>
                {money(data.outstanding_debt)}
              </div>
              <div className="mini-stat-label">долг</div>
            </div>
            <div className="mini-stat">
              <div className="mini-stat-value">{money(data.lifetime_spend)}</div>
              <div className="mini-stat-label">оплачено всего</div>
            </div>
          </div>

          <div className="field" style={{ marginTop: 18 }}>
            <label htmlFor="guest-notes">Пожелания и заметки</label>
            <textarea
              id="guest-notes"
              className="notes-area"
              value={notes}
              onChange={(event) => {
                setNotes(event.target.value)
                setSavedAt(false)
              }}
              placeholder="Номер подальше от лифта, аллергия, постоянный клиент…"
              rows={3}
            />
            <div className="notes-foot">
              <button
                type="button"
                className="btn btn-sm"
                onClick={saveNotes}
                disabled={savingNotes || notes === data.notes}
              >
                {savingNotes ? 'Сохранение…' : 'Сохранить заметку'}
              </button>
              {savedAt && <span className="notes-saved">Сохранено</span>}
            </div>
          </div>

          <div className="panel-title" style={{ marginTop: 20 }}>
            Брони
            <span className="count">{data.stays.length}</span>
          </div>

          {data.stays.length === 0 ? (
            <div className="unit-empty">Броней ещё не было</div>
          ) : (
            <div className="stay-list">
              {data.stays.map((stay) => (
                <div key={stay.booking_id} className="stay-row">
                  <div>
                    <div className="stay-unit">{stay.unit_name}</div>
                    <div className="stay-dates">{dateRange(stay.date_from, stay.date_to)}</div>
                  </div>
                  <div className="stay-money">
                    <div>{money(stay.total_amount + stay.charges_amount, stay.currency)}</div>
                    {stay.remaining_amount > 0 ? (
                      <div className="money-due">долг {money(stay.remaining_amount, stay.currency)}</div>
                    ) : (
                      <div className="stay-status">{STATUS_LABELS[stay.status]}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {/* Over the modal rather than instead of it: the sheet is a preview
              of a printout, and closing it puts the reader back where they
              were rather than at the top of the page. */}
          {showSheet && <GuestSheet data={data} onClose={() => setShowSheet(false)} />}
        </>
      ) : null}
    </Modal>
  )
}