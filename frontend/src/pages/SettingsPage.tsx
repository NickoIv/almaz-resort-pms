import { useCallback, useEffect, useState } from 'react'
import { api, downloadAuthed } from '../api'
import RestoreModal from '../components/RestoreModal'
import { Alert, Spinner } from '../components/ui'

type NotificationKey =
  | 'notify_checkins'
  | 'notify_checkouts'
  | 'notify_cleaning'
  | 'notify_unpaid'

type NotifyChannel = 'whatsapp' | 'telegram' | 'both'

type StoredBackups = {
  configured: boolean
  kind: 'kv' | 'r2' | null
  retention?: number
  backups: { key: string; uploaded: string | null; size: number | null }[]
}

type TextSettings = {
  hotel_name: string
  hotel_details: string
  reviews_2gis_url: string
  reviews_google_url: string
}

type SettingsResponse = {
  notifications: Record<NotificationKey, boolean>
  channel: NotifyChannel
  text: TextSettings
  whatsapp_configured: boolean
  telegram_configured: boolean
}

const TOGGLES: { key: NotificationKey; icon: string; title: string; hint: string }[] = [
  {
    key: 'notify_checkins',
    icon: '🛎',
    title: 'Заезды',
    hint: 'Кто заезжает сегодня — номер, имя гостя, телефон',
  },
  {
    key: 'notify_checkouts',
    icon: '🚪',
    title: 'Выезды',
    hint: 'Кто выезжает сегодня и остался ли долг',
  },
  {
    key: 'notify_cleaning',
    icon: '🧹',
    title: 'Просроченная уборка',
    hint: 'Свободные объекты с незакрытым чек-листом',
  },
  {
    key: 'notify_unpaid',
    icon: '💰',
    title: 'Невнесённая доплата',
    hint: 'Активные брони с остатком к оплате',
  },
]

const CHANNELS: { key: NotifyChannel; label: string; hint: string }[] = [
  { key: 'whatsapp', label: 'WhatsApp', hint: 'Через Green API' },
  { key: 'telegram', label: 'Telegram', hint: 'Резервный канал' },
  { key: 'both', label: 'Оба', hint: 'Дублировать сообщения' },
]

export default function SettingsPage() {
  const [data, setData] = useState<SettingsResponse | null>(null)
  const [preview, setPreview] = useState<{ empty: boolean; text: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [stored, setStored] = useState<StoredBackups | null>(null)
  // Text fields are edited locally and saved on blur, so every keystroke is
  // not a PUT.
  const [text, setText] = useState<TextSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      api<SettingsResponse>('/settings'),
      api<{ empty: boolean; sections: number; text: string }>('/settings/preview'),
      api<StoredBackups>('/backup/stored').catch(() => null),
    ])
      .then(([settings, digest, backups]) => {
        setData(settings)
        setText(settings.text)
        setPreview(digest)
        setStored(backups)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Ошибка загрузки'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  async function save(body: Record<string, unknown>, key: string) {
    setSaving(key)
    setError(null)
    setNotice(null)
    try {
      const next = await api<SettingsResponse>('/settings', { method: 'PUT', body })
      setData(next)
      setText(next.text)
      setPreview(await api('/settings/preview'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить')
    } finally {
      setSaving(null)
    }
  }

  async function sendTest() {
    setSending(true)
    setError(null)
    setNotice(null)
    try {
      const result = await api<{
        sent: boolean
        channel: NotifyChannel
        sections: number
        results: { channel: string; sent: boolean; error?: string }[]
      }>('/settings/test-notification', { method: 'POST' })

      const ok = result.results.filter((r) => r.sent).map((r) => r.channel)
      const failed = result.results.filter((r) => !r.sent)
      setNotice(
        `Отправлено: ${ok.join(', ')}.` +
          (failed.length > 0 ? ` Не удалось: ${failed.map((f) => f.channel).join(', ')}.` : '')
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отправить')
    } finally {
      setSending(false)
    }
  }

  async function downloadBackup() {
    setDownloading(true)
    setError(null)
    setNotice(null)
    try {
      await downloadAuthed('/backup/export', 'taura-pms-backup.json')
      setNotice('Резервная копия скачана. Храните её вне этого компьютера.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось скачать копию')
    } finally {
      setDownloading(false)
    }
  }

  if (loading) return <Spinner />

  const channel = data?.channel ?? 'whatsapp'
  const needsWhatsApp = (channel === 'whatsapp' || channel === 'both') && !data?.whatsapp_configured
  const needsTelegram = (channel === 'telegram' || channel === 'both') && !data?.telegram_configured
  const canSend = !needsWhatsApp && !needsTelegram

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Настройки</h1>
          <div className="page-sub">Уведомления персоналу · сводка в 09:00 и 18:00</div>
        </div>
        <div className="page-head-actions">
          <button className="btn btn-sm btn-primary" onClick={sendTest} disabled={sending || !canSend}>
            {sending ? 'Отправка…' : 'Отправить тест'}
          </button>
        </div>
      </div>

      {error && <Alert>{error}</Alert>}
      {notice && <div className="notice">{notice}</div>}

      {needsWhatsApp && (
        <div className="notice notice-warn">
          WhatsApp пока не подключён. Заведите инстанс на green-api.com и задайте секреты на
          сервере: <code>npx wrangler secret put GREEN_API_INSTANCE_ID</code>,
          <code>npx wrangler secret put GREEN_API_TOKEN</code> и
          <code>npx wrangler secret put GREEN_API_CHAT_ID</code> (номер или id группы вида
          <code>77011112233@c.us</code>). До этого рассылка не работает.
        </div>
      )}

      {needsTelegram && (
        <div className="notice notice-warn">
          Telegram выбран как канал, но не подключён — задайте
          <code>TELEGRAM_BOT_TOKEN</code> и <code>TELEGRAM_CHAT_ID</code>.
        </div>
      )}

      <section className="panel glass" style={{ marginBottom: 18 }}>
        <div className="panel-title">
          Канал отправки
          <span className="count">
            {data?.whatsapp_configured ? 'WhatsApp подключён' : 'WhatsApp не подключён'}
            {data?.telegram_configured ? ' · Telegram подключён' : ''}
          </span>
        </div>
        <div className="chip-row">
          {CHANNELS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`chip ${channel === item.key ? 'active' : ''}`}
              onClick={() => save({ channel: item.key }, item.key)}
              disabled={saving === item.key}
              title={item.hint}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="field-hint" style={{ marginTop: 10 }}>
          Основной канал — WhatsApp через Green API. Telegram сохранён как резервный: выберите
          «Оба», чтобы дублировать сводку в оба мессенджера.
        </div>
      </section>

      <section className="panel glass" style={{ marginBottom: 18 }}>
        <div className="panel-title">
          Реквизиты и отзывы
          <span className="count">название печатается на чеке</span>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="hotel-name">Название</label>
            <input
              id="hotel-name"
              value={text?.hotel_name ?? ''}
              onChange={(event) => setText((t) => t && { ...t, hotel_name: event.target.value })}
              onBlur={() => text && save({ hotel_name: text.hotel_name }, 'hotel_name')}
              placeholder="Taura"
            />
          </div>
          <div className="field">
            <label htmlFor="hotel-details">Адрес / телефон / БИН</label>
            <input
              id="hotel-details"
              value={text?.hotel_details ?? ''}
              onChange={(event) => setText((t) => t && { ...t, hotel_details: event.target.value })}
              onBlur={() => text && save({ hotel_details: text.hotel_details }, 'hotel_details')}
              placeholder="Алматы, ул. …"
            />
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="url-2gis">Ссылка на 2ГИС</label>
            <input
              id="url-2gis"
              type="url"
              value={text?.reviews_2gis_url ?? ''}
              onChange={(event) =>
                setText((t) => t && { ...t, reviews_2gis_url: event.target.value })
              }
              onBlur={() => text && save({ reviews_2gis_url: text.reviews_2gis_url }, '2gis')}
              placeholder="https://2gis.kz/almaty/firm/…"
            />
          </div>
          <div className="field">
            <label htmlFor="url-google">Ссылка на Google</label>
            <input
              id="url-google"
              type="url"
              value={text?.reviews_google_url ?? ''}
              onChange={(event) =>
                setText((t) => t && { ...t, reviews_google_url: event.target.value })
              }
              onBlur={() => text && save({ reviews_google_url: text.reviews_google_url }, 'google')}
              placeholder="https://g.page/…"
            />
          </div>
        </div>

        <div className="field-hint">
          Ссылки появятся кнопкой «Отзывы» в шапке — персонал сможет быстро открыть профиль и
          попросить гостя оставить отзыв. Сохраняется при выходе из поля.
        </div>
      </section>

      <section className="panel glass" style={{ marginBottom: 18 }}>
        <div className="panel-title">Резервная копия</div>
        <p className="field-hint" style={{ marginBottom: 14 }}>
          Один JSON-файл со всеми данными: объекты, брони, платежи, начисления, чек-листы уборки,
          сотрудники (без PIN-кодов), заметки о гостях, настройки и журнал действий. У Cloudflare D1
          нет отмены удаления — эта копия единственный способ вернуть данные.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-sm" onClick={downloadBackup} disabled={downloading}>
            {downloading ? 'Готовим файл…' : 'Скачать резервную копию'}
          </button>
          <button className="btn btn-sm btn-danger" onClick={() => setRestoring(true)}>
            Восстановить из копии
          </button>
        </div>

        {stored && (
          <div className="field-hint" style={{ marginTop: 14 }}>
            {stored.configured ? (
              <>
                Автоматические копии ({stored.kind === 'kv' ? 'Workers KV' : 'R2'}): хранится{' '}
                {stored.backups.length} из {stored.retention}, ежедневно в 09:15.
                {stored.backups[0] && <> Последняя: {stored.backups[0].key.split('/').pop()}.</>}
              </>
            ) : (
              <>Автоматические копии не настроены — хранилище не подключено.</>
            )}
          </div>
        )}
      </section>

      <div className="detail-grid">
        <section className="panel glass">
          <div className="panel-title">Какие уведомления отправлять</div>

          <div className="check-list">
            {TOGGLES.map((item) => {
              const on = data?.notifications[item.key] ?? false
              return (
                <button
                  key={item.key}
                  type="button"
                  className={`check-item setting-item ${on ? 'done' : ''}`}
                  onClick={() => save({ [item.key]: !on }, item.key)}
                  disabled={saving === item.key}
                >
                  <span className="setting-icon">{item.icon}</span>
                  <span className="setting-text">
                    <span className="check-label">{item.title}</span>
                    <span className="setting-hint">{item.hint}</span>
                  </span>
                  <span className={`switch ${on ? 'on' : ''}`}>
                    <span className="switch-knob" />
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        <section className="panel glass">
          <div className="panel-title">
            Предпросмотр сводки
            <span className="count">как сейчас</span>
          </div>
          {preview?.empty ? (
            <div className="unit-empty">
              Сейчас сообщать не о чем — заездов, выездов, просроченной уборки и долгов нет.
            </div>
          ) : (
            // The API already returns plain text; no markup to strip.
            <pre className="digest-preview">{preview?.text ?? ''}</pre>
          )}
        </section>
      </div>

      {restoring && (
        <RestoreModal onClose={() => setRestoring(false)} onRestored={load} />
      )}
    </>
  )
}