import { HTTPException } from 'hono/http-exception'

/**
 * Костровая зона — пакет, а не объект.
 *
 * Гостиница сдаёт её целиком под одно событие: беседки, топчаны и сцена, до ста
 * гостей, банкетное меню от 17 000 ₸ с человека. Продаётся это иначе, чем
 * беседка на вечер, и потому живёт отдельным типом объекта: цена считается от
 * числа гостей, а не от числа часов, и **на время события внутри не должно быть
 * посторонних**.
 *
 * ## Одна бронь, а не восемь
 *
 * Пакет — одна запись брони на один объект. Восемь отдельных броней на беседки
 * и топчаны выглядели бы честнее и были бы хуже: их пришлось бы держать в
 * согласии при каждом изменении дат, при отмене, при оплате, а деньги за
 * событие всё равно одни и делить их между топчанами бессмысленно.
 *
 * ## Но исключительность обязана работать в обе стороны
 *
 * Раз отдельных броней нет, кто-то может продать беседку 3 на тот же вечер — и
 * гость приедет на свой юбилей к чужому столу. Поэтому здесь два запрета, и оба
 * живут внутри `assertSellable`, то есть на всех путях, которые пишут бронь:
 *
 *   - участника нельзя продать, пока зона занята;
 *   - зону нельзя продать, пока занят хоть один участник.
 *
 * Состав зоны — свойство участника (`units.part_of_unit_id`), а не список на
 * зоне: связь нужна ровно там, где решается, можно ли продать беседку 3.
 */

/** Пересечение по полуоткрытому правилу — то же, что у броней и блокировок. */
const OVERLAP = `datetime(b.date_from) < datetime(?) AND datetime(b.date_to) > datetime(?)`

/**
 * Отказывает, если объект — часть пакета, который на эти часы уже продан.
 */
async function assertZoneFree(
  db: D1Database,
  unitId: number,
  dateFrom: string,
  dateTo: string
): Promise<void> {
  const clash = await db
    .prepare(
      `SELECT b.id, b.guest_name, z.name AS zone_name
         FROM units u
         JOIN units z ON z.id = u.part_of_unit_id
         JOIN bookings b ON b.unit_id = z.id AND b.status <> 'free' AND ${OVERLAP}
        WHERE u.id = ?
        LIMIT 1`
    )
    .bind(dateTo, dateFrom, unitId)
    .first<{ id: number; guest_name: string; zone_name: string }>()

  if (clash) {
    throw new HTTPException(409, {
      message:
        `${clash.zone_name} занята целиком на это время — событие «${clash.guest_name}», ` +
        `бронь #${clash.id}. Отдельные объекты внутри зоны продавать нельзя.`,
    })
  }
}

/**
 * Отказывает, если внутри пакета уже сидит чья-то отдельная бронь.
 *
 * Имена занятых объектов — в сообщении: «зона занята» без ответа на «кем
 * именно» отправляет человека искать по всем беседкам вручную.
 */
async function assertMembersFree(
  db: D1Database,
  zoneId: number,
  dateFrom: string,
  dateTo: string
): Promise<void> {
  const { results } = await db
    .prepare(
      `SELECT u.name, b.id, b.guest_name
         FROM units u
         JOIN bookings b ON b.unit_id = u.id AND b.status <> 'free' AND ${OVERLAP}
        WHERE u.part_of_unit_id = ?
        ORDER BY u.name`
    )
    .bind(dateTo, dateFrom, zoneId)
    .all<{ name: string; id: number; guest_name: string }>()

  if (results.length > 0) {
    const who = results.map((row) => `${row.name} (${row.guest_name})`).join(', ')
    throw new HTTPException(409, {
      message:
        `Внутри зоны на это время уже заняты: ${who}. ` +
        `Событие продаётся целиком, поэтому эти брони надо закрыть или перенести.`,
    })
  }
}

/**
 * Обе проверки разом. Вызывается из `assertSellable`, чтобы правило действовало
 * на всех пяти путях записи брони, а не на том, которым сегодня пользуются.
 */
export async function assertZoneExclusivity(
  db: D1Database,
  unitId: number,
  unitType: string,
  dateFrom: string,
  dateTo: string
): Promise<void> {
  if (unitType === 'banquet_zone') {
    await assertMembersFree(db, unitId, dateFrom, dateTo)
    return
  }
  await assertZoneFree(db, unitId, dateFrom, dateTo)
}

/**
 * Сколько стоит событие.
 *
 * По умолчанию — цена с человека, умноженная на число гостей: так его и
 * считают. Но администратор торгуется, поэтому итог можно поставить руками, и
 * тогда он побеждает — иначе цифра, о которой договорились с гостем, тихо
 * пересчиталась бы при следующем сохранении.
 */
export function banquetTotal(
  guests: number | null | undefined,
  perPerson: number | null | undefined,
  manualTotal: number | null | undefined
): number {
  if (manualTotal !== null && manualTotal !== undefined && manualTotal > 0) {
    return Number(manualTotal.toFixed(2))
  }
  const count = Math.max(0, Number(guests ?? 0))
  const price = Math.max(0, Number(perPerson ?? 0))
  return Number((count * price).toFixed(2))
}
