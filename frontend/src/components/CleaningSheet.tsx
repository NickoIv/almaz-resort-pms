import { useEffect, useState } from 'react'
import { api } from '../api'
import { Alert, Spinner } from './ui'
import { UNIT_TYPE_LABELS, type UnitType } from '../types'

type SheetUnit = {
  id: number
  name: string
  type: UnitType
  category: string | null
  waiting_since: string | null
  items: { id: number; item_name: string; is_done: boolean }[]
}

type Sheet = { generated_at: string; units: SheetUnit[] }

/**
 * Printable shift sheet for housekeeping.
 *
 * Rendered as an overlay rather than a route: the browser's own print
 * stylesheet does the work (see `@media print` in index.css), so there is no
 * PDF library and no second page to keep in step with the app. Checkboxes are
 * drawn as empty squares to be ticked with a pen — already-done items are
 * shown crossed through so a partly cleaned unit is not started over.
 */
export default function CleaningSheet({ onClose }: { onClose: () => void }) {
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<Sheet>('/cleaning/sheet')
      .then(setSheet)
      .catch((err) => setError(err instanceof Error ? err.message : 'Ошибка загрузки'))
  }, [])

  // Escape closes it, matching every other overlay in the app.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="sheet-overlay">
      <div className="sheet-toolbar no-print">
        <button className="btn btn-sm btn-primary" onClick={() => window.print()} disabled={!sheet}>
          Печать
        </button>
        <button className="btn btn-sm btn-ghost" onClick={onClose}>
          Закрыть
        </button>
        <span className="field-hint">
          В диалоге печати выберите «Сохранить как PDF», чтобы отправить файл.
        </span>
      </div>

      {error && <Alert>{error}</Alert>}

      {!sheet ? (
        <Spinner />
      ) : (
        <div className="print-sheet">
          <header className="sheet-head">
            <h1>Задания на смену — уборка</h1>
            <div className="sheet-meta">
              Сформировано: {sheet.generated_at} · объектов: {sheet.units.length}
            </div>
          </header>

          {sheet.units.length === 0 ? (
            <p>Убирать нечего — все объекты чистые.</p>
          ) : (
            sheet.units.map((unit) => (
              <section className="sheet-unit" key={unit.id}>
                <div className="sheet-unit-head">
                  <h2>
                    {unit.type === 'room' ? `Номер ${unit.name}` : unit.name}
                    <span className="sheet-unit-type">
                      {UNIT_TYPE_LABELS[unit.type]}
                      {unit.category ? ` · ${unit.category}` : ''}
                    </span>
                  </h2>
                  <div className="sheet-since">
                    {unit.waiting_since ? `Ожидает с ${unit.waiting_since}` : ''}
                  </div>
                </div>

                <ul className="sheet-items">
                  {unit.items.map((item) => (
                    <li key={item.id} className={item.is_done ? 'is-done' : ''}>
                      <span className="sheet-box">{item.is_done ? '×' : ''}</span>
                      {item.item_name}
                    </li>
                  ))}
                </ul>

                <div className="sheet-sign">
                  Убрал(а): ____________________ Время: __________ Подпись: __________
                </div>
              </section>
            ))
          )}
        </div>
      )}
    </div>
  )
}
