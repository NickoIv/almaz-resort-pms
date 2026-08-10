/**
 * Turning the audit log's action codes into Russian.
 *
 * Shared by the full log page and the dashboard's recent-activity tile, so an
 * event reads identically wherever it surfaces.
 */
import { CANCEL_REASON_LABELS, type CancelReason } from './cancellation'
import type { Role } from './types'

export type AuditEntry = {
  id: number
  staff_user_id: number | null
  staff_name: string | null
  staff_role: Role | null
  action: string
  entity: string
  entity_id: number | null
  created_at: string
  target: string | null
  guest_name: string | null
}

/** Human wording for the action verbs written by writeAudit(). */
const ACTION_LABELS: Record<string, string> = {
  'login': 'Вход в систему',
  'booking.create': 'Создана бронь',
  'booking.quick': 'Быстрая бронь',
  'booking.payment': 'Внесена оплата',
  'booking.group.create': 'Создана групповая бронь',
  'booking.group.payment': 'Оплата по группе',
  'charge.create': 'Начисление добавлено',
  'charge.delete': 'Начисление удалено',
  'cleaning.done': 'Пункт уборки выполнен',
  'cleaning.undone': 'Пункт уборки снят',
  'cleaning.reset': 'Чек-лист сброшен',
  'settings.update': 'Изменены настройки',
  'guest.notes': 'Заметка о госте',
  'guest.notes.update': 'Заметка о госте изменена',
  'waitlist.create': 'Добавлен в лист ожидания',
  'photo.delete': 'Фото удалено',
  'backup.export': 'Выгружена резервная копия',
  'backup.restore': 'Восстановление из копии',
  'login.disabled': 'Отказ: учётная запись отключена',
  'push.subscribe': 'Включены уведомления на устройстве',
  'push.unsubscribe': 'Выключены уведомления на устройстве',
  'push.test': 'Проверка уведомлений',
}

/** Photo kinds, as they appear in `photo.upload:<kind>`. */
const PHOTO_KINDS: Record<string, string> = {
  before: 'до уборки',
  after: 'после уборки',
  damage: 'повреждение',
  other: 'прочее',
}

/** Waitlist transitions, as they appear in `waitlist.update:<status>`. */
const WAITLIST_WORDS: Record<string, string> = {
  open: 'снова в ожидании',
  placed: 'размещён',
  closed: 'закрыт',
}

const ROLE_WORDS: Record<string, string> = {
  admin: 'администратор',
  housekeeper: 'горничная',
  waiter: 'официант',
}

/**
 * `staff.update:` carries what changed, joined with '+' — e.g. `name+role:waiter`.
 * Each token is translated on its own so the journal reads as a sentence
 * rather than as the field names the API happened to use.
 */
function staffChange(token: string): string {
  if (token.startsWith('role:')) {
    const role = token.slice(5)
    return `роль → ${ROLE_WORDS[role] ?? role}`
  }
  return (
    { name: 'имя', pin: 'PIN', enabled: 'доступ включён', disabled: 'доступ отключён' }[token] ??
    token
  )
}

const STATUS_WORDS: Record<string, string> = {
  free: 'выезд / отмена',
  booked: 'бронь',
  occupied: 'заселение',
}

/** Coarse buckets the filter chips offer. */
export const GROUP_LABELS: Record<string, string> = {
  booking: 'Брони',
  charge: 'Начисления',
  cleaning: 'Уборка',
  settings: 'Настройки',
  login: 'Входы',
  guest: 'Гости',
  notification: 'Уведомления',
  photo: 'Фото',
  waitlist: 'Лист ожидания',
  backup: 'Резервные копии',
  staff: 'Персонал',
}

export function describeAudit(entry: AuditEntry): string {
  if (ACTION_LABELS[entry.action]) return ACTION_LABELS[entry.action]

  // booking.update:<status>[:<reason>] — the reason is present when a booking
  // was ended, which is what distinguishes a checkout from a cancellation.
  if (entry.action.startsWith('booking.update:')) {
    const [, status, reason] = entry.action.split(':')
    const base = `Изменена бронь — ${STATUS_WORDS[status] ?? status}`
    return reason
      ? `${base} (${CANCEL_REASON_LABELS[reason as CancelReason] ?? reason})`
      : base
  }
  if (entry.action.startsWith('notification.test')) {
    return `Тест уведомления (${entry.action.split(':')[1] ?? ''})`.trim()
  }
  if (entry.action.startsWith('photo.upload:')) {
    const kind = entry.action.split(':')[1]
    return `Загружено фото (${PHOTO_KINDS[kind] ?? kind})`
  }
  if (entry.action.startsWith('waitlist.update:')) {
    const status = entry.action.split(':')[1]
    return `Лист ожидания — ${WAITLIST_WORDS[status] ?? status}`
  }
  if (entry.action.startsWith('staff.create:')) {
    const role = entry.action.slice('staff.create:'.length)
    return `Добавлен сотрудник (${ROLE_WORDS[role] ?? role})`
  }
  if (entry.action.startsWith('staff.update:')) {
    const changed = entry.action.slice('staff.update:'.length).split('+').map(staffChange)
    return `Изменён сотрудник — ${changed.join(', ')}`
  }
  return entry.action
}
