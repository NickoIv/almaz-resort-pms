import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { assertUnitTypeAllowed } from '../lib/access'
import { requireRole } from '../lib/auth'
import { writeAudit } from '../lib/audit'
import { cleanOptional } from '../lib/text'
import type { AppEnv, UnitType } from '../types'

const photos = new Hono<AppEnv>()

/**
 * Internal photo documentation — damage, before/after cleaning.
 *
 * Never guest-facing: every route requires a staff token, and the bytes are
 * served back through the Worker rather than from a public URL, so an image
 * cannot leak by someone sharing a link.
 *
 * Storage is the PHOTOS KV namespace, deliberately separate from the backup
 * namespace so photos cannot crowd out backups. KV caps a value at 25 MiB;
 * the per-file limit here is far lower because these are phone snapshots, not
 * archives, and because a hundred of them still has to be affordable.
 */
const MAX_BYTES = 3 * 1024 * 1024

/** Per unit, to keep the gallery and the namespace bounded. */
const MAX_PER_UNIT = 30

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

const PHOTO_KINDS = ['before', 'after', 'damage', 'other'] as const
type PhotoKind = (typeof PHOTO_KINDS)[number]

type PhotoRow = {
  id: number
  unit_id: number
  booking_id: number | null
  storage_key: string
  content_type: string
  size_bytes: number
  kind: PhotoKind
  caption: string | null
  created_at: string
  created_by_name: string | null
}

// Housekeepers document cleaning, waiters document the recreation area, admins
// see everything. The unit-type check below keeps each role in its own area.
const canPhoto = requireRole('admin', 'housekeeper', 'waiter')

async function loadUnit(db: D1Database, unitId: number) {
  const unit = await db
    .prepare('SELECT id, type FROM units WHERE id = ?')
    .bind(unitId)
    .first<{ id: number; type: UnitType }>()
  if (!unit) throw new HTTPException(404, { message: 'Объект не найден' })
  return unit
}

function store(c: { env: AppEnv['Bindings'] }) {
  if (!c.env.PHOTOS) {
    throw new HTTPException(503, { message: 'Хранилище фото не настроено' })
  }
  return c.env.PHOTOS
}

/** GET /api/photos/unit/:unitId — metadata only; bytes come from /file. */
photos.get('/unit/:unitId', canPhoto, async (c) => {
  const staff = c.get('staff')
  const unitId = Number(c.req.param('unitId'))
  if (!Number.isInteger(unitId)) throw new HTTPException(400, { message: 'Invalid unit id' })

  const unit = await loadUnit(c.env.DB, unitId)
  assertUnitTypeAllowed(staff.role, unit.type)

  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.unit_id, p.booking_id, p.storage_key, p.content_type, p.size_bytes,
            p.kind, p.caption, p.created_at, su.name AS created_by_name
     FROM unit_photos p
     LEFT JOIN staff_users su ON su.id = p.created_by
     WHERE p.unit_id = ?
     ORDER BY p.created_at DESC, p.id DESC`
  )
    .bind(unitId)
    .all<PhotoRow>()

  return c.json({ max_bytes: MAX_BYTES, max_per_unit: MAX_PER_UNIT, photos: results })
})

/**
 * POST /api/photos/unit/:unitId — multipart upload.
 * Fields: file, kind, caption, booking_id.
 */
photos.post('/unit/:unitId', canPhoto, async (c) => {
  const staff = c.get('staff')
  const unitId = Number(c.req.param('unitId'))
  if (!Number.isInteger(unitId)) throw new HTTPException(400, { message: 'Invalid unit id' })

  const unit = await loadUnit(c.env.DB, unitId)
  assertUnitTypeAllowed(staff.role, unit.type)

  const form = await c.req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) {
    throw new HTTPException(400, { message: 'Приложите файл изображения' })
  }

  // Trust the sniffed type, not the filename: an extension proves nothing.
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new HTTPException(400, {
      message: `Формат ${file.type || 'неизвестен'}; допустимы JPEG, PNG и WebP`,
    })
  }
  if (file.size === 0) throw new HTTPException(400, { message: 'Файл пустой' })
  if (file.size > MAX_BYTES) {
    throw new HTTPException(413, {
      message: `Файл ${(file.size / 1048576).toFixed(1)} МБ — максимум ${MAX_BYTES / 1048576} МБ`,
    })
  }

  const countRow = await c.env.DB.prepare(
    'SELECT COUNT(*) AS count FROM unit_photos WHERE unit_id = ?'
  )
    .bind(unitId)
    .first<{ count: number }>()
  if ((countRow?.count ?? 0) >= MAX_PER_UNIT) {
    throw new HTTPException(409, {
      message: `У объекта уже ${MAX_PER_UNIT} фото — удалите лишние`,
    })
  }

  const kind = PHOTO_KINDS.includes(c.req.query('kind') as PhotoKind)
    ? (c.req.query('kind') as PhotoKind)
    : ((form?.get('kind') as string) ?? 'other')
  const safeKind = PHOTO_KINDS.includes(kind as PhotoKind) ? kind : 'other'

  const storageKey = `unit-${unitId}/${crypto.randomUUID()}`
  await store(c).put(storageKey, await file.arrayBuffer(), {
    metadata: { content_type: file.type, unit_id: unitId },
  })

  const bookingIdRaw = form?.get('booking_id')
  const bookingId = bookingIdRaw ? Number(bookingIdRaw) : null

  const created = await c.env.DB.prepare(
    `INSERT INTO unit_photos (unit_id, booking_id, storage_key, content_type, size_bytes, kind, caption, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id`
  )
    .bind(
      unitId,
      Number.isInteger(bookingId) ? bookingId : null,
      storageKey,
      file.type,
      file.size,
      safeKind,
      cleanOptional(form?.get('caption'), 200),
      staff.sub
    )
    .first<{ id: number }>()

  await writeAudit(c.env.DB, staff.sub, `photo.upload:${safeKind}`, 'unit_photos', created?.id ?? null)

  return c.json({ id: created?.id, storage_key: storageKey, size_bytes: file.size }, 201)
})

/**
 * GET /api/photos/:id/file — the image bytes.
 * Served through the Worker so the token is checked on every view; a KV key
 * alone is never enough to see a photo.
 */
photos.get('/:id/file', canPhoto, async (c) => {
  const staff = c.get('staff')
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) throw new HTTPException(400, { message: 'Invalid photo id' })

  const photo = await c.env.DB.prepare(
    `SELECT p.storage_key, p.content_type, u.type AS unit_type
     FROM unit_photos p JOIN units u ON u.id = p.unit_id
     WHERE p.id = ?`
  )
    .bind(id)
    .first<{ storage_key: string; content_type: string; unit_type: UnitType }>()

  if (!photo) throw new HTTPException(404, { message: 'Фото не найдено' })
  assertUnitTypeAllowed(staff.role, photo.unit_type)

  const body = await store(c).get(photo.storage_key, 'arrayBuffer')
  if (!body) throw new HTTPException(404, { message: 'Файл отсутствует в хранилище' })

  return new Response(body, {
    headers: {
      'Content-Type': photo.content_type,
      // Internal documentation: cache in the browser, never in a shared cache.
      'Cache-Control': 'private, max-age=3600',
    },
  })
})

/** DELETE /api/photos/:id — admin only, so documentation is not quietly erased. */
photos.delete('/:id', requireRole('admin'), async (c) => {
  const staff = c.get('staff')
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) throw new HTTPException(400, { message: 'Invalid photo id' })

  const photo = await c.env.DB.prepare('SELECT storage_key FROM unit_photos WHERE id = ?')
    .bind(id)
    .first<{ storage_key: string }>()
  if (!photo) throw new HTTPException(404, { message: 'Фото не найдено' })

  // Remove the row first: an orphaned KV value is harmless, a row pointing at
  // nothing shows a broken image.
  await c.env.DB.prepare('DELETE FROM unit_photos WHERE id = ?').bind(id).run()
  await store(c).delete(photo.storage_key)

  await writeAudit(c.env.DB, staff.sub, 'photo.delete', 'unit_photos', id)
  return c.json({ deleted: true })
})

export default photos
