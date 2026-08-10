import { useState, type ChangeEvent, type FormEvent } from 'react'
import { api } from '../api'
import { Alert, Modal } from './ui'

const CONFIRMATION = 'ВОССТАНОВИТЬ'

/**
 * Backup markers this build will open, newest first. Must stay in step with
 * `BACKUP_FORMAT` / `LEGACY_BACKUP_FORMATS` in the Worker — a file the server
 * would accept but this screen refuses can never be uploaded at all.
 */
const BACKUP_FORMATS = ['taura-pms-backup', 'almaz-resort-pms-backup']

type BackupPreview = {
  exported_at?: string
  exported_at_almaty?: string
  schema_version?: string | null
  counts?: Record<string, number>
}

type RestoreResult = {
  ok: boolean
  restored: Record<string, number>
  staff_updated: number
  staff_added_disabled: string[]
  staff_left_alone: number
  total_rows: number
  pre_restore_snapshot: string | null
}

/**
 * Uploads a backup file and replaces the database with it.
 * Destructive, so the file is parsed and summarised locally first — the admin
 * sees what they are about to restore before the confirmation unlocks.
 */
export default function RestoreModal({
  onClose,
  onRestored,
}: {
  onClose: () => void
  onRestored: () => void
}) {
  const [file, setFile] = useState<unknown>(null)
  const [preview, setPreview] = useState<BackupPreview | null>(null)
  const [fileName, setFileName] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RestoreResult | null>(null)
  const [restoring, setRestoring] = useState(false)

  async function pickFile(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0]
    setError(null)
    setPreview(null)
    setFile(null)
    if (!chosen) return

    setFileName(chosen.name)
    try {
      const parsed = JSON.parse(await chosen.text())
      // Both markers, and the old one for good: every backup written before the
      // project took the hotel's name carries it, including the daily snapshots
      // nobody made by hand. The server checks the same two.
      if (!BACKUP_FORMATS.includes(parsed?.format)) {
        setError('Это не резервная копия Taura PMS')
        return
      }
      setFile(parsed)
      setPreview(parsed)
    } catch {
      setError('Не удалось прочитать файл — это не JSON')
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setRestoring(true)
    try {
      setResult(await api<RestoreResult>('/backup/restore', {
        method: 'POST',
        body: { confirm, backup: file },
      }))
      onRestored()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось восстановить')
    } finally {
      setRestoring(false)
    }
  }

  if (result) {
    return (
      <Modal title="Восстановление завершено" onClose={onClose}>
        <div className="notice">Восстановлено строк: {result.total_rows}</div>

        <div className="info-rows" style={{ marginTop: 14 }}>
          {Object.entries(result.restored).map(([table, count]) => (
            <div className="info-row" key={table}>
              <span>{table}</span>
              <span>{count}</span>
            </div>
          ))}
        </div>

        <div className="notice notice-warn" style={{ marginTop: 16 }}>
          PIN-коды не хранятся в копии. У существующих сотрудников они сохранены
          ({result.staff_updated} обновлено).
          {result.staff_added_disabled.length > 0 && (
            <>
              {' '}
              Новые записи созданы отключёнными — задайте им PIN на странице «Персонал»:{' '}
              {result.staff_added_disabled.join(', ')}.
            </>
          )}
          {result.staff_left_alone > 0 && (
            <> Сотрудников, которых не было в копии, оставлено без изменений: {result.staff_left_alone}.</>
          )}
        </div>

        {result.pre_restore_snapshot && (
          <div className="field-hint" style={{ marginTop: 12 }}>
            Состояние до восстановления сохранено как{' '}
            <code>{result.pre_restore_snapshot}</code>.
          </div>
        )}

        <div className="modal-actions">
          <button className="btn btn-primary" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Восстановление из копии" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="notice notice-warn">
          Все текущие данные — брони, платежи, начисления, журнал — будут заменены содержимым
          файла. Отменить это нельзя. Сначала скачайте свежую копию.
        </div>

        {error && <Alert>{error}</Alert>}

        <div className="field">
          <label htmlFor="backup-file">Файл резервной копии</label>
          <input id="backup-file" type="file" accept="application/json,.json" onChange={pickFile} />
          {fileName && <div className="field-hint">{fileName}</div>}
        </div>

        {preview && (
          <div className="restore-preview">
            <div className="info-row">
              <span>Создана</span>
              <span>{preview.exported_at_almaty || preview.exported_at || '—'}</span>
            </div>
            <div className="info-row">
              <span>Схема</span>
              <span>{preview.schema_version ?? '—'}</span>
            </div>
            {preview.counts &&
              Object.entries(preview.counts).map(([table, count]) => (
                <div className="info-row" key={table}>
                  <span>{table}</span>
                  <span>{count}</span>
                </div>
              ))}
          </div>
        )}

        <div className="field">
          <label htmlFor="confirm">
            Для подтверждения введите <b>{CONFIRMATION}</b>
          </label>
          <input
            id="confirm"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            placeholder={CONFIRMATION}
            autoComplete="off"
          />
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Отмена
          </button>
          <button
            type="submit"
            className="btn btn-danger"
            disabled={restoring || !file || confirm !== CONFIRMATION}
          >
            {restoring ? 'Восстановление…' : 'Восстановить'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
