import type { UnitType } from '../types'

/** Checklist a housekeeper works through after a guest leaves. */
export const ROOM_CHECKLIST_TEMPLATE = [
  'Смена постельного белья',
  'Уборка санузла',
  'Полотенца и халаты',
  'Пылесос и полы',
  'Мусорные корзины',
  'Мини-бар и чайник',
  'Проветривание',
  'Финальная проверка',
]

export const OUTDOOR_CHECKLIST_TEMPLATE = [
  'Убрать посуду',
  'Протереть стол и лавки',
  'Заменить скатерть',
  'Вынести мусор',
  'Подмести площадку',
]

export function checklistTemplate(type: UnitType): string[] {
  return type === 'room' ? ROOM_CHECKLIST_TEMPLATE : OUTDOOR_CHECKLIST_TEMPLATE
}

/**
 * Replaces a unit's checklist with a fresh unticked copy of the template.
 * Called on checkout so the unit shows up as "needs cleaning".
 */
export async function resetChecklist(
  db: D1Database,
  unitId: number,
  unitType: UnitType,
  bookingId: number | null
): Promise<void> {
  const items = checklistTemplate(unitType)
  const statements = [
    db.prepare('DELETE FROM cleaning_checklist WHERE unit_id = ?').bind(unitId),
    ...items.map((item) =>
      db
        .prepare(
          'INSERT INTO cleaning_checklist (unit_id, booking_id, item_name, is_done) VALUES (?, ?, ?, 0)'
        )
        .bind(unitId, bookingId, item)
    ),
  ]
  await db.batch(statements)
}