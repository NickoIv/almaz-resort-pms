import { SQL_NOW } from './time'

/**
 * Full-database export and restore.
 *
 * D1 has no undo and no point-in-time recovery on the free plan, so a JSON
 * snapshot is the only safety net. The format is deliberately plain — an admin
 * with a text editor can read it, and `wrangler d1 execute` can rebuild from it
 * without this app running at all (see the README).
 */

export const BACKUP_FORMAT = 'almaz-resort-pms-backup'

/**
 * Bump when the *shape* of the file changes, not when the database schema
 * does — `schema_version` below tracks that separately.
 */
export const BACKUP_FORMAT_VERSION = 1

/**
 * Every table, in dependency order: parents before children, so a restore can
 * insert straight down the list without tripping a foreign key.
 *
 * `staff_users` deliberately omits `pin_code_hash` — a backup file should not
 * be a credential store. See restoreAll() for what that means on the way back.
 */
export const BACKUP_TABLES = [
  { name: 'units', columns: ['id', 'type', 'name', 'category', 'capacity'] },
  {
    name: 'staff_users',
    columns: ['id', 'name', 'phone', 'role', 'is_active'],
  },
  {
    name: 'booking_groups',
    columns: ['id', 'name', 'guest_name', 'guest_phone', 'note', 'created_at', 'created_by'],
  },
  {
    name: 'bookings',
    columns: [
      'id', 'unit_id', 'guest_name', 'guest_phone', 'date_from', 'date_to', 'status',
      'total_amount', 'prepaid_amount', 'deposit_amount', 'currency', 'created_at', 'group_id',
    ],
  },
  {
    name: 'payments',
    columns: ['id', 'booking_id', 'amount', 'method', 'paid_at', 'group_id'],
  },
  {
    name: 'charges',
    columns: ['id', 'booking_id', 'reason', 'amount', 'created_at', 'created_by'],
  },
  {
    name: 'cleaning_checklist',
    columns: ['id', 'unit_id', 'booking_id', 'item_name', 'is_done', 'updated_at', 'updated_by'],
  },
  {
    name: 'guest_notes',
    columns: ['phone', 'notes', 'updated_at', 'updated_by'],
  },
  { name: 'settings', columns: ['key', 'value', 'updated_at', 'updated_by'] },
  {
    name: 'audit_log',
    columns: ['id', 'staff_user_id', 'action', 'entity', 'entity_id', 'created_at'],
  },
] as const

export type BackupTableName = (typeof BACKUP_TABLES)[number]['name']

export type BackupFile = {
  format: string
  format_version: number
  /** Latest applied migration, so it is obvious which schema produced this. */
  schema_version: string | null
  app_version: string
  exported_at: string
  exported_at_almaty: string
  counts: Record<string, number>
  tables: Record<string, Record<string, unknown>[]>
  notes: string[]
}

/** Reads the newest applied migration name as the schema marker. */
async function schemaVersion(db: D1Database): Promise<string | null> {
  try {
    const row = await db
      .prepare('SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1')
      .first<{ name: string }>()
    return row?.name ?? null
  } catch {
    return null
  }
}

export async function exportAll(db: D1Database, appVersion = 'unknown'): Promise<BackupFile> {
  const tables: Record<string, Record<string, unknown>[]> = {}
  const counts: Record<string, number> = {}

  for (const table of BACKUP_TABLES) {
    const { results } = await db
      .prepare(`SELECT ${table.columns.join(', ')} FROM ${table.name}`)
      .all<Record<string, unknown>>()
    tables[table.name] = results
    counts[table.name] = results.length
  }

  const nowRow = await db.prepare(`SELECT ${SQL_NOW} AS now`).first<{ now: string }>()

  return {
    format: BACKUP_FORMAT,
    format_version: BACKUP_FORMAT_VERSION,
    schema_version: await schemaVersion(db),
    app_version: appVersion,
    exported_at: new Date().toISOString(),
    exported_at_almaty: nowRow?.now ?? '',
    counts,
    tables,
    notes: [
      'staff_users не содержит PIN-хэши: файл резервной копии не должен быть хранилищем паролей.',
      'При восстановлении PIN-коды существующих сотрудников сохраняются; новые записи создаются отключёнными.',
    ],
  }
}

/** A filename that sorts chronologically and is safe on every filesystem. */
export function backupFilename(date = new Date()): string {
  return `almaz-pms-backup-${date.toISOString().replace(/[:.]/g, '-').slice(0, 19)}Z.json`
}
