import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { api, authedBlobUrl } from '../api'
import { useAuth } from '../auth'
import { Alert } from './ui'

type PhotoKind = 'before' | 'after' | 'damage' | 'other'

type Photo = {
  id: number
  unit_id: number
  booking_id: number | null
  content_type: string
  size_bytes: number
  kind: PhotoKind
  caption: string | null
  created_at: string
  created_by_name: string | null
}

type PhotoList = { max_bytes: number; max_per_unit: number; photos: Photo[] }

const KIND_LABELS: Record<PhotoKind, string> = {
  before: 'До уборки',
  after: 'После уборки',
  damage: 'Повреждение',
  other: 'Прочее',
}

const KINDS: PhotoKind[] = ['before', 'after', 'damage', 'other']

/**
 * Internal photo documentation for a unit — damage, before/after cleaning.
 *
 * Never guest-facing. Images are fetched with the staff token and shown from
 * object URLs, so there is no public link to a photo; a signed-out browser
 * cannot render one.
 */
export default function PhotoGallery({
  unitId,
  bookingId,
}: {
  unitId: number
  bookingId?: number | null
}) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [list, setList] = useState<PhotoList | null>(null)
  const [urls, setUrls] = useState<Record<number, string>>({})
  const [kind, setKind] = useState<PhotoKind>('damage')
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    api<PhotoList>(`/photos/unit/${unitId}`)
      .then(setList)
      .catch((err) => setError(err instanceof Error ? err.message : 'Ошибка загрузки'))
  }, [unitId])

  useEffect(load, [load])

  // Fetch each image with the bearer token and keep the object URLs, revoking
  // them on unmount so the blobs are not leaked.
  useEffect(() => {
    if (!list) return
    let cancelled = false
    const created: string[] = []

    Promise.all(
      list.photos.map(async (photo) => {
        if (urls[photo.id]) return null
        try {
          const url = await authedBlobUrl(`/photos/${photo.id}/file`)
          created.push(url)
          return [photo.id, url] as const
        } catch {
          return null
        }
      })
    ).then((pairs) => {
      if (cancelled) return
      const fresh = Object.fromEntries(pairs.filter(Boolean) as (readonly [number, string])[])
      if (Object.keys(fresh).length > 0) setUrls((prev) => ({ ...prev, ...fresh }))
    })

    return () => {
      cancelled = true
      created.forEach((url) => URL.revokeObjectURL(url))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list])

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    setUploading(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('kind', kind)
      if (bookingId) form.append('booking_id', String(bookingId))

      await api(`/photos/unit/${unitId}`, { method: 'POST', body: form })
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить фото')
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  async function remove(photo: Photo) {
    if (!window.confirm('Удалить фото? Это документация — восстановить нельзя.')) return
    try {
      await api(`/photos/${photo.id}`, { method: 'DELETE' })
      setUrls((prev) => {
        const next = { ...prev }
        delete next[photo.id]
        return next
      })
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось удалить')
    }
  }

  const full = list ? list.photos.length >= list.max_per_unit : false

  return (
    <section className="panel glass">
      <div className="panel-title">
        Фотодокументация
        <span className="count">
          {list ? `${list.photos.length} / ${list.max_per_unit}` : '…'} · только для персонала
        </span>
      </div>

      {error && <Alert>{error}</Alert>}

      <div className="chip-row" style={{ marginBottom: 12 }}>
        {KINDS.map((item) => (
          <button
            key={item}
            type="button"
            className={`chip chip-sm ${kind === item ? 'active' : ''}`}
            onClick={() => setKind(item)}
          >
            {KIND_LABELS[item]}
          </button>
        ))}
      </div>

      <div className="field">
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={upload}
          disabled={uploading || full}
        />
        <div className="field-hint">
          {full
            ? 'Достигнут лимит фото для этого объекта — удалите лишние.'
            : `JPEG, PNG или WebP, до ${list ? Math.round(list.max_bytes / 1048576) : 3} МБ. Тип: ${KIND_LABELS[kind]}.`}
        </div>
      </div>

      {list && list.photos.length > 0 && (
        <div className="photo-grid">
          {list.photos.map((photo) => (
            <figure className="photo" key={photo.id}>
              {urls[photo.id] ? (
                <a href={urls[photo.id]} target="_blank" rel="noreferrer">
                  <img src={urls[photo.id]} alt={photo.caption ?? KIND_LABELS[photo.kind]} />
                </a>
              ) : (
                <div className="photo-placeholder" />
              )}
              <figcaption>
                <span className={`photo-kind kind-${photo.kind}`}>{KIND_LABELS[photo.kind]}</span>
                <span className="photo-meta">
                  {photo.created_at.slice(0, 16)}
                  {photo.created_by_name ? ` · ${photo.created_by_name}` : ''}
                </span>
                {isAdmin && (
                  <button className="photo-remove" onClick={() => remove(photo)} title="Удалить">
                    ×
                  </button>
                )}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </section>
  )
}
