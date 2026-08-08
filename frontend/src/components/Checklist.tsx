import { useState } from 'react'
import { api } from '../api'
import { StatusDot } from './ui'
import type { ChecklistItem } from '../types'

/** Cleaning checklist — tapping a row toggles it and records who did it. */
export default function Checklist({
  items,
  onChanged,
}: {
  items: ChecklistItem[]
  onChanged: (item: ChecklistItem) => void
}) {
  const [busyId, setBusyId] = useState<number | null>(null)

  async function toggle(item: ChecklistItem) {
    setBusyId(item.id)
    try {
      const updated = await api<ChecklistItem>(`/cleaning/${item.id}`, {
        method: 'PATCH',
        body: { is_done: !item.is_done },
      })
      onChanged(updated)
    } finally {
      setBusyId(null)
    }
  }

  if (items.length === 0) {
    return <div className="unit-empty">Чек-лист пуст — номер убран.</div>
  }

  return (
    <div className="check-list">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`check-item ${item.is_done ? 'done' : ''}`}
          onClick={() => toggle(item)}
          disabled={busyId === item.id}
        >
          <span className="check-box">{item.is_done ? '✓' : ''}</span>
          <span className="check-label">{item.item_name}</span>
          {item.is_done && item.updated_by_name && (
            <span className="check-by">{item.updated_by_name}</span>
          )}
          {!item.is_done && <StatusDot status="cleaning" />}
        </button>
      ))}
    </div>
  )
}