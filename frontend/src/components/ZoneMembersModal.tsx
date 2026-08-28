import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../api'
import { Alert, Modal, Spinner } from './ui'
import { UNIT_TYPE_LABELS, type Unit } from '../types'

/**
 * Из чего состоит костровая зона.
 *
 * Состав не заложен миграцией намеренно. В рекламе «пять беседок и два
 * топчана», а в базе четыре беседки, две VIP-беседки и шесть топчанов — какие
 * именно входят в зону, знает гостиница. Угадать значило бы записать неправду в
 * данные, от которых зависит запрет двойной продажи: беседка, ошибочно
 * отмеченная как часть зоны, перестанет продаваться отдельно, а забытая — будет
 * продана поверх чужого юбилея.
 */
export default function ZoneMembersModal({
  unit: zone,
  onClose,
  onSaved,
}: {
  unit: Unit
  onClose: () => void
  onSaved: () => void
}) {
  const [options, setOptions] = useState<Unit[] | null>(null)
  const [picked, setPicked] = useState<Set<number>>(
    new Set((zone.members ?? []).map((member) => member.id))
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api<Unit[]>('/units?type=sunbed,gazebo,vip_gazebo')
      .then(setOptions)
      .catch((err) => setError(err instanceof Error ? err.message : 'Не удалось загрузить объекты'))
  }, [])

  function toggle(id: number) {
    setPicked((was) => {
      const next = new Set(was)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await api(`/units/${zone.id}/members`, { method: 'PUT', body: { unit_ids: [...picked] } })
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить состав')
    } finally {
      setSaving(false)
    }
  }

  const seats = (options ?? [])
    .filter((unit) => picked.has(unit.id))
    .reduce((sum, unit) => sum + unit.capacity, 0)

  return (
    <Modal title="Состав костровой зоны" onClose={onClose}>
      <form onSubmit={submit}>
        {error && <Alert>{error}</Alert>}

        <div className="notice">
          Отмеченные объекты нельзя будет продать отдельно, пока в зоне идёт событие, — и наоборот,
          зону нельзя будет продать, если что-то из них уже занято.
        </div>

        {!options ? (
          <Spinner />
        ) : (
          <div className="row-list">
            {options.map((unit) => (
              <label key={unit.id} className="check-row">
                <input
                  type="checkbox"
                  checked={picked.has(unit.id)}
                  onChange={() => toggle(unit.id)}
                />
                <span>
                  {unit.name}
                  <span className="field-hint">
                    {' '}
                    {UNIT_TYPE_LABELS[unit.type].toLowerCase()} · до {unit.capacity} чел.
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}

        {/* Сумма мест — проверка на здравый смысл: зона заявлена на сто гостей,
            и если отмеченного хватает на двенадцать, отмечено не всё. */}
        {picked.size > 0 && (
          <div className="field-hint" style={{ marginTop: 12 }}>
            Отмечено {picked.size}, посадочных мест {seats} из заявленных {zone.capacity}.
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving || !options}>
            {saving ? 'Сохранение…' : 'Сохранить состав'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
