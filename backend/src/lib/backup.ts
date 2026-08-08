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
    name: 'waitlist',
    columns: [
      'id', 'guest_name', 'guest_phone', 'unit_type', 'unit_id', 'date_from', 'date_to',
      'note', 'status', 'created_at', 'created_by', 'closed_at', 'closed_by',
    ],
  },
  // Metadata only — the image bytes live in the PHOTOS namespace and would
  // blow past the backup file's size ceiling if inlined.
  {
    name: 'unit_photos',
    columns: [
      'id', 'unit_id', 'booking_id', 'storage_key', 'content_type', 'size_bytes',
      'kind', 'caption', 'created_at', 'created_by',
    ],
  },
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
  return `taura-pms-backup-${date.toISOString().replace(/[:.]/g, '-').slice(0, 19)}Z.json`
}

/* ── Restore ──────────────────────────────────────────────────────────────── */

/**
 * Stored in place of a real hash for staff who exist in the backup but not in
 * the database. verifyPin() splits on '$' and needs five parts, so this can
 * never match any PIN — the account is restored disabled and an admin sets a
 * new PIN from the Персонал page.
 */
export const NO_PIN_SENTINEL = 'restore$no-pin-set'

/** D1 caps bound parameters per statement; stay well under it. */
const MAX_PARAMS_PER_STATEMENT = 90

/** Refuse rather than half-restore a database too large for one atomic batch. */
const MAX_TOTAL_ROWS = 50_000

export class RestoreError extends Error {}

export type RestoreReport = {
  restored: Record<string, number>
  staff_updated: number
  staff_added_disabled: string[]
  staff_left_alone: number
  total_rows: number
  statements: number
}

/**
 * Checks a file is a backup this build can restore.
 * Exported so the route can reject a bad upload *before* doing any work —
 * otherwise a fumbled file would still cost a pre-restore snapshot.
 */
export function assertValidBackup(file: unknown): asserts file is BackupFile {
  const candidate = file as Partial<BackupFile> | null
  if (!candidate || typeof candidate !== 'object') {
    throw new RestoreError('Файл повреждён или не является JSON-объектом')
  }
  if (candidate.format !== BACKUP_FORMAT) {
    throw new RestoreError(
      `Это не резервная копия Taura PMS (format: ${String(candidate.format)})`
    )
  }
  if (candidate.format_version !== BACKUP_FORMAT_VERSION) {
    throw new RestoreError(
      `Версия формата ${String(candidate.format_version)} не поддерживается (нужна ${BACKUP_FORMAT_VERSION})`
    )
  }
  if (!candidate.tables || typeof candidate.tables !== 'object') {
    throw new RestoreError('В файле нет раздела tables')
  }
  for (const table of BACKUP_TABLES) {
    const rows = candidate.tables[table.name]
    if (rows !== undefined && !Array.isArray(rows)) {
      throw new RestoreError(`Таблица ${table.name} должна быть массивом`)
    }
  }
}

/** `INSERT INTO t (a, b) VALUES (?, ?), (?, ?)` for a chunk of rows. */
function insertStatement(
  db: D1Database,
  table: string,
  columns: readonly string[],
  rows: Record<string, unknown>[]
): D1PreparedStatement {
  const placeholders = rows.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ')
  const values = rows.flatMap((row) => columns.map((column) => row[column] ?? null))
  return db
    .prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders}`)
    .bind(...values)
}

/**
 * Replaces the database contents with a backup file.
 *
 * Atomicity: D1 exposes no interactive transaction, so every statement goes
 * into a single `batch()` — which D1 runs as one implicit transaction. Either
 * the whole restore lands or the database is untouched. That is also why an
 * oversized backup is refused instead of split across batches, which would
 * lose the guarantee.
 *
 * Staff are treated differently from every other table. Because the backup
 * carries no PIN hashes, wiping and reinserting staff_users would lock
 * everyone out. Instead:
 *   - a row whose id already exists keeps its hash, and takes the backup's
 *     name, phone and role
 *   - a row that is new is inserted disabled with an unusable hash
 *   - staff present now but absent from the backup are left alone — they may
 *     have been created after it was taken
 *   - the admin running the restore is never disabled by it
 */
export async function restoreAll(
  db: D1Database,
  file: unknown,
  actorId: number
): Promise<RestoreReport> {
  assertValidBackup(file)

  const totalRows = BACKUP_TABLES.reduce(
    (sum, table) => sum + (file.tables[table.name]?.length ?? 0),
    0
  )
  if (totalRows > MAX_TOTAL_ROWS) {
    throw new RestoreError(
      `В копии ${totalRows} строк — слишком много для одной атомарной операции. ` +
        `Используйте восстановление через wrangler CLI (см. README).`
    )
  }

  const { results: currentStaff } = await db
    .prepare('SELECT id, phone FROM staff_users')
    .all<{ id: number; phone: string }>()
  const existingIds = new Set(currentStaff.map((row) => row.id))

  const statements: D1PreparedStatement[] = []
  const restored: Record<string, number> = {}

  // Children first, so nothing is left pointing at a deleted parent.
  for (const table of [...BACKUP_TABLES].reverse()) {
    if (table.name === 'staff_users') continue
    statements.push(db.prepare(`DELETE FROM ${table.name}`))
  }

  // Then insert parents first.
  for (const table of BACKUP_TABLES) {
    const rows = file.tables[table.name] ?? []
    restored[table.name] = rows.length
    if (table.name === 'staff_users' || rows.length === 0) continue

    const perStatement = Math.max(1, Math.floor(MAX_PARAMS_PER_STATEMENT / table.columns.length))
    for (let i = 0; i < rows.length; i += perStatement) {
      statements.push(insertStatement(db, table.name, table.columns, rows.slice(i, i + perStatement)))
    }
  }

  // ── staff_users, handled by hand ────────────────────────────────────────
  const staffRows = (file.tables.staff_users ?? []) as {
    id: number
    name: string
    phone: string
    role: string
    is_active: number | boolean
  }[]

  const addedDisabled: string[] = []
  let updated = 0

  for (const row of staffRows) {
    const id = Number(row.id)
    // Never let a restore switch off the account performing it.
    const isActive = id === actorId ? 1 : row.is_active ? 1 : 0

    if (existingIds.has(id)) {
      updated++
      statements.push(
        db
          .prepare('UPDATE staff_users SET name = ?, phone = ?, role = ?, is_active = ? WHERE id = ?')
          .bind(row.name, row.phone, row.role, isActive, id)
      )
    } else {
      addedDisabled.push(row.name)
      statements.push(
        db
          .prepare(
            `INSERT INTO staff_users (id, name, phone, role, pin_code_hash, is_active)
             VALUES (?, ?, ?, ?, ?, 0)`
          )
          .bind(id, row.name, row.phone, row.role, NO_PIN_SENTINEL)
      )
    }
  }
  restored.staff_users = staffRows.length

  // One batch = one transaction. All of it, or none of it.
  await db.batch(statements)

  return {
    restored,
    staff_updated: updated,
    staff_added_disabled: addedDisabled,
    staff_left_alone: currentStaff.length - updated,
    total_rows: totalRows,
    statements: statements.length,
  }
}
