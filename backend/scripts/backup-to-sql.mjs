#!/usr/bin/env node
/**
 * Converts a backup JSON file into SQL for `wrangler d1 execute --file`.
 *
 * This is the disaster-recovery path: it needs nothing but wrangler and works
 * when the app itself will not start. The UI restore in Настройки covers the
 * everyday case.
 *
 *   node scripts/backup-to-sql.mjs backup.json > restore.sql
 *   npx wrangler d1 execute DB --remote --file restore.sql
 */
import { readFileSync } from 'node:fs'

// Must match BACKUP_TABLES in src/lib/backup.ts — parents first.
const TABLES = [
  ['units', ['id', 'type', 'name', 'category', 'capacity']],
  ['staff_users', ['id', 'name', 'phone', 'role', 'is_active']],
  ['booking_groups', ['id', 'name', 'guest_name', 'guest_phone', 'note', 'created_at', 'created_by']],
  ['bookings', ['id', 'unit_id', 'guest_name', 'guest_phone', 'date_from', 'date_to', 'status',
    'total_amount', 'prepaid_amount', 'deposit_amount', 'currency', 'created_at', 'group_id']],
  ['payments', ['id', 'booking_id', 'amount', 'method', 'paid_at', 'group_id']],
  ['charges', ['id', 'booking_id', 'reason', 'amount', 'created_at', 'created_by']],
  ['cleaning_checklist', ['id', 'unit_id', 'booking_id', 'item_name', 'is_done', 'updated_at', 'updated_by']],
  ['guest_notes', ['phone', 'notes', 'updated_at', 'updated_by']],
  ['settings', ['key', 'value', 'updated_at', 'updated_by']],
  ['audit_log', ['id', 'staff_user_id', 'action', 'entity', 'entity_id', 'created_at']],
]

const path = process.argv[2]
if (!path) {
  console.error('usage: node scripts/backup-to-sql.mjs <backup.json> > restore.sql')
  process.exit(1)
}

const file = JSON.parse(readFileSync(path, 'utf8'))
if (file.format !== 'almaz-resort-pms-backup') {
  console.error(`Not an Almaz Resort PMS backup (format: ${file.format})`)
  process.exit(1)
}

/** SQLite literal. Strings are single-quoted with '' escaping. */
function literal(value) {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? '1' : '0'
  return `'${String(value).replace(/'/g, "''")}'`
}

const out = []
out.push(`-- Restore generated from ${path}`)
out.push(`-- Exported at: ${file.exported_at} (schema ${file.schema_version})`)
out.push('')
out.push('PRAGMA foreign_keys = OFF;')
out.push('BEGIN TRANSACTION;')
out.push('')

// Children first so nothing is left pointing at a deleted parent.
for (const [table] of [...TABLES].reverse()) {
  if (table === 'staff_users') continue // never wiped: it holds the PIN hashes
  out.push(`DELETE FROM ${table};`)
}
out.push('')

for (const [table, columns] of TABLES) {
  const rows = file.tables[table] ?? []
  if (rows.length === 0) continue

  out.push(`-- ${table}: ${rows.length} rows`)

  if (table === 'staff_users') {
    // The backup has no PIN hashes. Upsert by id so existing accounts keep
    // theirs; anything genuinely new arrives disabled and unusable until an
    // admin sets a PIN.
    for (const row of rows) {
      const values = columns.map((c) => literal(row[c]))
      out.push(
        `INSERT INTO staff_users (${columns.join(', ')}, pin_code_hash) ` +
          `VALUES (${values.join(', ')}, 'restore$no-pin-set') ` +
          `ON CONFLICT(id) DO UPDATE SET name = excluded.name, phone = excluded.phone, ` +
          `role = excluded.role, is_active = excluded.is_active;`
      )
    }
    out.push('')
    continue
  }

  // Batched multi-row inserts keep the file small enough to paste or pipe.
  const CHUNK = 50
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const tuples = chunk.map((row) => `(${columns.map((c) => literal(row[c])).join(', ')})`)
    out.push(`INSERT INTO ${table} (${columns.join(', ')}) VALUES\n  ${tuples.join(',\n  ')};`)
  }
  out.push('')
}

out.push('COMMIT;')
out.push('PRAGMA foreign_keys = ON;')

process.stdout.write(out.join('\n') + '\n')
