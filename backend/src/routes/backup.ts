import { Hono } from 'hono'
import { requireRole } from '../lib/auth'
import { writeAudit } from '../lib/audit'
import { backupFilename, exportAll } from '../lib/backup'
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

export default backup
