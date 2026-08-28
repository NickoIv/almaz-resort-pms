import { SQL_NOW } from './time'
import type { UnitType } from '../types'

/**
 * How long a unit may sit unclean before the Cleaning page flags it red.
 * Change this one number to retune the SLA.
 */
export const CLEANING_SLA_MINUTES = 60

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

/**
 * Баня. Своя уборка, а не «номер» и не «беседка».
 *
 * Ни одной бани пока не заведено — она откроется позже, — но шаблон нужен
 * заранее: `checklistTemplate` иначе выдала бы ей уличный список, и первая же
 * баня получила бы «заменить скатерть» вместо котла и слива. Список короткий и
 * про то, что в бане действительно делают между гостями.
 */
export const SAUNA_CHECKLIST_TEMPLATE = [
  'Слить и промыть купель',
  'Помыть полки и пол в парной',
  'Проветрить и просушить парную',
  'Сменить простыни и полотенца',
  'Помыть душевую и санузел',
  'Вынести мусор',
  'Проверить котёл и воду',
  'Комната отдыха: стол и посуда',
]

export function checklistTemplate(type: UnitType): string[] {
  if (type === 'room') return ROOM_CHECKLIST_TEMPLATE
  if (type === 'sauna') return SAUNA_CHECKLIST_TEMPLATE
  return OUTDOOR_CHECKLIST_TEMPLATE
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
          `INSERT INTO cleaning_checklist (unit_id, booking_id, item_name, is_done, created_at)
           VALUES (?, ?, ?, 0, ${SQL_NOW})`
        )
        .bind(unitId, bookingId, item)
    ),
  ]
  await db.batch(statements)
}