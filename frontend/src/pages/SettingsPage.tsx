import { useCallback, useEffect, useState } from 'react'
import { api, downloadAuthed } from '../api'
import RatesPanel from '../components/RatesPanel'
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
  invoice_legal_name: string
  invoice_tax_id: string
  invoice_legal_address: string
  invoice_contact: string
  invoice_bank: string
  invoice_terms: string
  vat_registered: string
  vat_rate: string
  vat_prices_include: string
}

/**
 * The legal block on the invoice. Every one of these is optional and the
 * invoice omits an empty line rather than printing a placeholder — a wrong BIN
 * on a document someone files in their accounts is worse than a missing one,
 * because a missing line is obvious and a wrong one is not.
 */
const INVOICE_FIELDS: {
  key: keyof TextSettings
  label: string
  placeholder: string
  wide?: boolean
}[] = [
  { key: 'invoice_legal_name', label: 'Юридическое лицо', placeholder: 'ТОО «Таура»' },
  { key: 'invoice_tax_id', label: 'БИН / ИИН', placeholder: '123456789012' },
  { key: 'invoice_legal_address', label: 'Юридический адрес', placeholder: 'Алматы, ул. …' },
  { key: 'invoice_contact', label: 'Телефон / e-mail для счетов', placeholder: '+7 … · billing@…' },
  {
    key: 'invoice_bank',
    label: 'Банковские реквизиты',
    placeholder: 'АО «Банк», IBAN KZ…, БИК …',
    wide: true,
  },
  {
    key: 'invoice_terms',
    label: 'Условия оплаты',
    placeholder: 'Оплата в течение 5 банковских дней с даты выставления счёта.',
    wide: true,
  },
]

/**
 * Groups the requisites into the rows they are actually laid out in: the
 * narrow ones two to a row, the wide ones alone, in the order declared above.
 *
 * They used to be written one per `.field-row`, and a `.field-row` is a
 * two-column grid — so each single child took the left column and left the
 * right one empty. On a desktop that was four half-width boxes with 489px of
 * nothing beside each of them; at 390px it was a legal address typed into
 * 156px. The `wide` flag was doing its half of the job all along; this is the
 * other half.
 */
function invoiceRows(): (typeof INVOICE_FIELDS)[] {
  const rows: (typeof INVOICE_FIELDS)[] = []
  for (const item of INVOICE_FIELDS) {
    const open = rows[rows.length - 1]
    const needsNewRow = item.wide || !open || open[0].wide || open.length === 2
    if (needsNewRow) rows.push([item])
    else open.push(item)
  }
  return rows
}

type SettingsResponse = {
  notifications: Record<NotificationKey, boolean>
  channel: NotifyChannel
  text: TextSettings
  /**
   * Whether the server will actually send anything. It answers false today —
   * staff work inside the app all shift — and this page follows it rather
   * than hardcoding the fact, so re-enabling delivery is one constant on the
   * server and the controls here come back with it.
   */
  external_delivery: boolean
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
      api<StoredBackups>('/backup/stored').catch(() => null),
    ])
      .then(([settings, backups]) => {
        setData(settings)
        setText(settings.text)
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
  const externalDelivery = data?.external_delivery ?? false
  const needsWhatsApp =
    externalDelivery && (channel === 'whatsapp' || channel === 'both') && !data?.whatsapp_configured
  const needsTelegram =
    externalDelivery && (channel === 'telegram' || channel === 'both') && !data?.telegram_configured
  const canSend = !needsWhatsApp && !needsTelegram

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Настройки</h1>
          <div className="page-sub">Состав сводки, реквизиты и резервные копии</div>
        </div>
        {externalDelivery && (
          <div className="page-head-actions">
            <button
              className="btn btn-sm btn-primary"
              onClick={sendTest}
              disabled={sending || !canSend}
            >
              {sending ? 'Отправка…' : 'Отправить тест'}
            </button>
          </div>
        )}
      </div>

      {error && <Alert>{error}</Alert>}
      {notice && <div className="notice">{notice}</div>}

      {needsWhatsApp && (
        <div className="notice notice-warn">
          WhatsApp пока не подключён. Заведите инстанс на green-api.com и задайте секреты на
          сервере: <code>npx wrangler secret put GREEN_API_INSTANCE_ID</code>,
          <code>npx wrangler secret put GREEN_API_TOKEN</code> и
          <code>npx wrangler secret put GREEN_API_CHAT_ID</code>.
        </div>
      )}

      {needsTelegram && (
        <div className="notice notice-warn">
          Telegram выбран как канал, но не подключён — задайте
          <code>TELEGRAM_BOT_TOKEN</code> и <code>TELEGRAM_CHAT_ID</code>.
        </div>
      )}

      <section className="panel glass" style={{ marginBottom: 16 }}>
        <div className="panel-title">
          Внешняя рассылка
          <span className="count">{externalDelivery ? 'включена' : 'не используется'}</span>
        </div>
        <div className="chip-row">
          {CHANNELS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`chip ${externalDelivery && channel === item.key ? 'active' : ''}`}
              onClick={externalDelivery ? () => save({ channel: item.key }, item.key) : undefined}
              disabled={!externalDelivery || saving === item.key}
              title={
                externalDelivery
                  ? item.hint
                  : 'Не используется — персонал работает через приложение'
              }
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="field-hint" style={{ marginTop: 16 }}>
          {externalDelivery ? (
            <>
              Основной канал — WhatsApp через Green API. Telegram сохранён как резервный:
              выберите «Оба», чтобы дублировать сводку в оба мессенджера.
            </>
          ) : (
            <>
              Не используется — персонал работает через приложение. Задачи видны на страницах
              «Уборка» и «Зона отдыха», срочное приходит в колокольчик со звуком, а сводка за
              день — на странице «Сводка». Рассылка в мессенджеры нужна, чтобы достучаться до
              человека вне приложения; здесь смена так не устроена. Код каналов сохранён — если
              рассылка снова понадобится, её включают на сервере.
            </>
          )}
        </div>
      </section>

      {/* НДС.
          Off until somebody says otherwise: whether this hotel is registered is
          a fact about the business, and while the switch is off the invoice
          prints exactly as it always did. It matters more than it used to —
          Kazakhstan's Tax Code of 1 January 2026 put the rate at 16% and the
          registration threshold at 40 млн ₸ a year. */}
      <section className="panel glass" style={{ marginBottom: 18 }}>
        <div className="panel-title">
          НДС
          <span className="count">печатается в инвойсе</span>
        </div>

        <div className="chip-row">
          {[
            { value: '0', label: 'Не плательщик НДС' },
            { value: '1', label: 'Плательщик НДС' },
          ].map((item) => (
            <button
              key={item.value}
              type="button"
              className={`chip ${(text?.vat_registered ?? '0') === item.value ? 'active' : ''}`}
              disabled={saving === 'vat_registered'}
              onClick={() => {
                setText((t) => t && { ...t, vat_registered: item.value })
                void save({ vat_registered: item.value }, 'vat_registered')
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        {text?.vat_registered === '1' ? (
          <>
            <div className="field-row is-text" style={{ marginTop: 16 }}>
              <div className="field">
                <label htmlFor="vat-rate">Ставка, %</label>
                <input
                  id="vat-rate"
                  type="number"
                  min="0"
                  max="100"
                  value={text.vat_rate}
                  onChange={(event) => setText((t) => t && { ...t, vat_rate: event.target.value })}
                  onBlur={() => text && save({ vat_rate: text.vat_rate }, 'vat_rate')}
                />
              </div>
            </div>

            <div className="chip-row" style={{ marginTop: 8 }}>
              {[
                { value: '1', label: 'Цены указаны с НДС' },
                { value: '0', label: 'Цены указаны без НДС' },
              ].map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={`chip ${text.vat_prices_include === item.value ? 'active' : ''}`}
                  disabled={saving === 'vat_prices_include'}
                  onClick={() => {
                    setText((t) => t && { ...t, vat_prices_include: item.value })
                    void save({ vat_prices_include: item.value }, 'vat_prices_include')
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="field-hint" style={{ marginTop: 16 }}>
              {text.vat_prices_include === '0' ? (
                <>
                  Суммы в прайсе и в бронях считаются <strong>без налога</strong>: в инвойсе НДС
                  начисляется сверху и <strong>увеличивает</strong> итог к оплате.
                </>
              ) : (
                <>
                  Суммы в прайсе и в бронях считаются <strong>с налогом</strong>: итог не
                  меняется, а в инвойсе появляется строка «в том числе НДС». Так обычно и бывает
                  в гостинице — гостю называют ту цену, которую он платит.
                </>
              )}
            </div>
          </>
        ) : (
          <div className="field-hint" style={{ marginTop: 16 }}>
            Инвойс печатается без строки налога, как и раньше. Включите, если отель стоит на
            учёте по НДС — компания не проведёт счёт без выделенного налога. С 1 января 2026
            ставка 16%, порог постановки на учёт — 40 млн ₸ в год.
          </div>
        )}
      </section>

      <RatesPanel />

      <section className="panel glass" style={{ marginBottom: 18 }}>
        <div className="panel-title">
          Реквизиты и отзывы
          <span className="count">название печатается на чеке</span>
        </div>

        <div className="field-row is-text">
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

        <div className="field-row is-text">
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

        <div className="field-hint" style={{ marginBottom: 18 }}>
          Ссылки появятся кнопкой «Отзывы» в шапке — персонал сможет быстро открыть профиль и
          попросить гостя оставить отзыв. Сохраняется при выходе из поля.
        </div>

        <div className="panel-title" style={{ marginTop: 8 }}>
          Реквизиты для инвойса
          <span className="count">печатаются в шапке счёта</span>
        </div>

        {invoiceRows().map((row) => {
          const fields = row.map((item) => (
            <div className="field" key={item.key}>
              <label htmlFor={item.key}>{item.label}</label>
              <input
                id={item.key}
                value={text?.[item.key] ?? ''}
                onChange={(event) =>
                  setText((t) => t && { ...t, [item.key]: event.target.value })
                }
                onBlur={() => text && save({ [item.key]: text[item.key] }, item.key)}
                placeholder={item.placeholder}
              />
            </div>
          ))

          return row[0].wide ? (
            fields
          ) : (
            <div className="field-row is-text" key={row[0].key}>
              {fields}
            </div>
          )
        })}

        <div className="field-hint">
          Пустые поля просто не печатаются — инвойс не подставляет заглушки вместо
          незаполненных реквизитов.
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

      <section className="panel glass">
        <div className="panel-title">
          Что попадает в сводку
          <span className="count">видно на странице «Сводка»</span>
        </div>

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

      {restoring && (
        <RestoreModal onClose={() => setRestoring(false)} onRestored={load} />
      )}
    </>
  )
}