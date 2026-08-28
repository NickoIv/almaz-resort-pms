import { useState, type FormEvent } from 'react'
import { api } from '../api'
import { Alert, Modal } from './ui'
import type { Unit } from '../types'

/**
 * Отправить объект на реставрацию.
 *
 * Отдельно от «снять с продажи», и разница не косметическая. Снятие — это
 * отрезок календаря: у него есть конец, его пишут, когда даты известны, и оно
 * отвечает на вопрос «что продаём на эти числа». Реставрация — про сам объект:
 * номера пока нет, дату открытия никто не знает, и вопрос другой — «сколько у
 * нас вообще номеров». Поэтому здесь нет полей дат: выдуманный конец пришлось
 * бы продлевать каждый раз, когда выдуманное число наступает.
 *
 * Пояснение необязательно, но спрашивается: «корпус, до открытия» — это разница
 * между отказом, с которым можно что-то сделать, и стеной.
 */
export default function RenovationModal({
  unit,
  onClose,
  onSaved,
}: {
  unit: Unit
  onClose: () => void
  onSaved: () => void
}) {
  const [note, setNote] = useState(unit.renovation?.note ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await api(`/units/${unit.id}/renovation`, { method: 'PUT', body: { note: note || null } })
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отметить реставрацию')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="На реставрацию" onClose={onClose}>
      <form onSubmit={submit}>
        {error && <Alert>{error}</Alert>}

        <div className="notice">
          <strong>{unit.name}</strong> пропадёт из продажи и из занятости, пока реставрация не
          закончится. Это не то же самое, что снять с продажи на даты: здесь нет конца, и объект не
          попадёт ни в прогноз, ни в знаменатель загрузки.
        </div>

        <div className="field">
          <label htmlFor="renovation-note">Пояснение</label>
          <input
            id="renovation-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Корпус, до открытия"
          />
          <div className="field-hint">
            Появится на карточке объекта и в отказе, если кто-то попробует его забронировать.
          </div>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Отмечаем…' : 'На реставрацию'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
