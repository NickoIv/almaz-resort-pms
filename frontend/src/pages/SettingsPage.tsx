import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { Alert, Spinner } from '../components/ui'

type NotificationKey =
  | 'notify_checkins'
  | 'notify_checkouts'
  | 'notify_cleaning'
  | 'notify_unpaid'

type SettingsResponse = {
  notifications: Record<NotificationKey, boolean>
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

export default function SettingsPage() {
  const [data, setData] = useState<SettingsResponse | null>(null)
  const [preview, setPreview] = useState<{ empty: boolean; text: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<NotificationKey | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      api<SettingsResponse>('/settings'),
      api<{ empty: boolean; sections: number; text: string }>('/settings/preview'),
    ])
      .then(([settings, digest]) => {
        setData(settings)
        setPreview(digest)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Ошибка загрузки'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  async function toggle(key: NotificationKey) {
    if (!data) return
    setSaving(key)
    setError(null)
    setNotice(null)
    try {
      const next = await api<SettingsResponse>('/settings', {
        method: 'PUT',
        body: { [key]: !data.notifications[key] },
      })
      setData(next)
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
      const result = await api<{ sent: boolean; sections: number }>('/settings/test-notification', {
        method: 'POST',
      })
      setNotice(
        result.sections > 0
          ? `Сообщение отправлено в Telegram (${result.sections} раздела).`
          : 'Сообщение отправлено: сообщать сейчас не о чем.'
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отправить')
    } finally {
      setSending(false)
    }
  }

  if (loading) return <Spinner />

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Настройки</h1>
          <div className="page-sub">Уведомления в Telegram · сводка в 09:00 и 18:00</div>
        </div>
        <div className="page-head-actions">
          <button
            className="btn btn-sm btn-primary"
            onClick={sendTest}
            disabled={sending || !data?.telegram_configured}
          >
            {sending ? 'Отправка…' : 'Отправить тест'}
          </button>
        </div>
      </div>

      {error && <Alert>{error}</Alert>}
      {notice && <div className="notice">{notice}</div>}

      {data && !data.telegram_configured && (
        <div className="notice notice-warn">
          Telegram пока не подключён. Задайте секреты на сервере:
          <code>npx wrangler secret put TELEGRAM_BOT_TOKEN</code> и
          <code>npx wrangler secret put TELEGRAM_CHAT_ID</code>. До этого рассылка не работает.
        </div>
      )}

      <div className="detail-grid">
        <section className="panel glass">
          <div className="panel-title">
            Какие уведомления отправлять
            {data?.telegram_configured && <span className="count">Telegram подключён</span>}
          </div>

          <div className="check-list">
            {TOGGLES.map((item) => {
              const on = data?.notifications[item.key] ?? false
              return (
                <button
                  key={item.key}
                  type="button"
                  className={`check-item setting-item ${on ? 'done' : ''}`}
                  onClick={() => toggle(item.key)}
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
            <pre className="digest-preview">{stripHtml(preview?.text ?? '')}</pre>
          )}
        </section>
      </div>
    </>
  )
}

/** The API returns Telegram-flavoured HTML; the preview shows it as plain text. */
function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}