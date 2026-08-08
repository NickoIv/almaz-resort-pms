import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { requireRole } from '../lib/auth'
import { readJson } from '../lib/body'
import { writeAudit } from '../lib/audit'
import {
  assertValidBackup,
  backupFilename,
  exportAll,
  RestoreError,
  restoreAll,
} from '../lib/backup'
import {
  backupStore,
  DAILY_PREFIX,
  PRE_RESTORE_PREFIX,
  PRE_RESTORE_RETENTION,
  prunePrefix,
  RETENTION,
} from '../lib/backup-store'
import type { AppEnv } from '../types'

const backup = new Hono<AppEnv>()

// A backup contains every guest name, phone and payment in the system.
backup.use('*', requireRole('admin'))

/**
 * GET /api/backup/export — the whole database as one JSON file.
 * Served as a download so the browser writes it straight to disk.
 */
backup.get('/export', async (c) => {
  const staff = c.get('staff')
  const file = await exportAll(c.env.DB, c.env.APP_VERSION ?? 'unknown')

  await writeAudit(c.env.DB, staff.sub, 'backup.export', 'settings', null)

  return new Response(JSON.stringify(file, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${backupFilename()}"`,
      // A snapshot of live data must never sit in a cache.
      'Cache-Control': 'no-store',
    },
  })
})

/** GET /api/backup/stored — the daily snapshots currently kept. */
backup.get('/stored', async (c) => {
  const store = backupStore(c.env)
  if (!store) return c.json({ configured: false, kind: null, backups: [] })

  const backups = await store.list(DAILY_PREFIX)
  return c.json({
    configured: true,
    kind: store.kind,
    retention: RETENTION,
    backups: backups.sort((a, b) => b.key.localeCompare(a.key)),
  })
})

/** The admin has to type this exactly; a stray click cannot wipe the database. */
const CONFIRMATION = 'ВОССТАНОВИТЬ'

/**
 * POST /api/backup/restore — replace the database from an uploaded file.
 *
 * Destructive, so it needs the typed confirmation, and it takes a snapshot of
 * the current state first: the whole point of this feature is that D1 has no
 * undo, and a restore is itself something you might want to undo.
 */
backup.post('/restore', async (c) => {
  const staff = c.get('staff')
  const body = await readJson<{ confirm: string; backup: unknown }>(c)

  if (body.confirm !== CONFIRMATION) {
    throw new HTTPException(400, {
      message: `Для подтверждения введите ${CONFIRMATION}`,
    })
  }
  if (!body.backup) {
    throw new HTTPException(400, { message: 'Не приложен файл резервной копии' })
  }

  // Validate before doing any work: a file that is going to be rejected should
  // not cost a snapshot write.
  try {
    assertValidBackup(body.backup)
  } catch (error) {
    throw new HTTPException(400, {
      message: error instanceof RestoreError ? error.message : 'Файл резервной копии повреждён',
    })
  }

  // Safety net before anything destructive happens.
  let snapshotKey: string | null = null
  try {
    const store = backupStore(c.env)
    if (store) {
      const current = await exportAll(c.env.DB, c.env.APP_VERSION ?? 'unknown')
      snapshotKey = `${PRE_RESTORE_PREFIX}${backupFilename()}`
      await store.put(snapshotKey, JSON.stringify(current))
      // Keep only the last few — restores are rare, but nothing else prunes these.
      await prunePrefix(store, PRE_RESTORE_PREFIX, PRE_RESTORE_RETENTION)
    }
  } catch (error) {
    console.error('pre-restore snapshot failed', error)
    snapshotKey = null
  }

  let report
  try {
    report = await restoreAll(c.env.DB, body.backup, staff.sub)
  } catch (error) {
    if (error instanceof RestoreError) {
      throw new HTTPException(400, { message: error.message })
    }
    // The batch is atomic, so a failure here left the database as it was.
    throw new HTTPException(500, {
      message: `Восстановление не выполнено, данные не изменены: ${
        error instanceof Error ? error.message : 'неизвестная ошибка'
      }`,
    })
  }

  await writeAudit(c.env.DB, staff.sub, 'backup.restore', 'settings', null)

  return c.json({
    ok: true,
    pre_restore_snapshot: snapshotKey,
    ...report,
  })
})

export default backup
