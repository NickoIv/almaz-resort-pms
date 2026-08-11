import { useState, type FormEvent } from 'react'
import { api } from '../api'
import { Alert, Modal } from './ui'
import { addDaysIso, todayIso } from '../format'
import { BLOCK_REASONS, BLOCK_REASON_LABELS, blockNeedsNote, type BlockReason } from '../blocks'

type Props = {
  unitId: number
  unitName: string
  /** Pre-fills the first night — the board passes whichever run was dragged. */
  initialFrom?: string
  onClose: () => void
  onSaved: () => void
}

/**
 * Снять объект с продажи — ремонт, санобработка, служебная бронь.
 *
 * Until this existed the only way to stop selling a room for three days was to
 * write a fake booking on a guest called «Ремонт». That is not a workaround, it
 * is data corruption with a friendly name: занятость counted those nights as
 * sold, the guest history grew a person who does not exist, «Начислено по
 * броням» added a price nobody would pay, and the no-show alert eventually
 * asked the desk to check in a leak.
 *
 * A block is a different kind of fact from a stay, so it is a different kind of
 * record, and the screen says so in as many words.
 */
export default function BlockModal({ unitId, unitName, initialFrom, onClose, onSaved }: Props) {
  const start = initialFrom ?? todayIso()
  const [dateFrom, setDateFrom] = useState(start)
  const [dateTo, setDateTo] = useState(addDaysIso(start, 1))
  const [reason, setReason] = useState<BlockReason>('repair')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await api('/blocks', {
        method: 'POST',
        body: { unit_id: unitId, date_from: dateFrom, date_to: dateTo, reason, note: note || null },
      })
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось снять с продажи')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={`Снять с продажи · ${unitName}`} onClose={onClose}>
      <form onSubmit={submit}>
        {error && <Alert>{error}</Alert>}

        <div className="notice">
          Это не бронь. Ночи не попадут в занятость, в историю гостей и в «Начислено по броням» —
          объект просто нельзя будет продать.
        </div>

        {/* The same half-open rule as a stay, said in words rather than assumed:
            «по» is the morning the object is sellable again, and getting this
            wrong by a day is the classic way a room comes back on sale while
            the painters are still in it. */}
        <div className="field-row">
          <div className="field">
            <label htmlFor="block-from">С</label>
            <input
              id="block-from"
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="block-to">По (утро)</label>
            <input
              id="block-to"
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              required
            />
          </div>
        </div>
        <div className="field-hint" style={{ marginTop: -8, marginBottom: 16 }}>
          Утром этой даты объект снова можно продавать — как день выезда у брони.
        </div>

        <div className="field">
          <label htmlFor="block-reason">Причина</label>
          <select
            id="block-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value as BlockReason)}
          >
            {BLOCK_REASONS.map((item) => (
              <option key={item} value={item}>
                {BLOCK_REASON_LABELS[item]}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="block-note">
            Комментарий{blockNeedsNote(reason) ? '' : ' (необязательно)'}
          </label>
          <input
            id="block-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={blockNeedsNote(reason) ? 'Опишите причину' : 'Что именно делаем'}
            required={blockNeedsNote(reason)}
          />
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Сохранение…' : 'Снять с продажи'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
