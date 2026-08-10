import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { Alert, Spinner } from '../components/ui'
import { useAuth } from '../auth'
import type { Role } from '../types'
import {
  currentSubscription,
  disablePush,
  enablePush,
  isIos,
  permissionState,
  pushSupport,
  sendTestPush,
  type PushSupport,
} from '../push'

type Device = {
  id: number
  endpoint: string
  user_agent: string | null
  created_at: string
  last_ok_at: string | null
}

/**
 * Switching notifications on, per person and per device.
 *
 * Open to every role, unlike Настройки. Notifications are not an administrative
 * setting: each member of staff has to grant permission on their own phone, and
 * nobody can do it for them — the browser will only accept the request from a
 * gesture by the person sitting in front of it.
 */

/**
 * What each role actually gets, in their own terms.
 *
 * Not decoration: a person deciding whether to allow notifications is deciding
 * how often their phone will interrupt them, and "уведомления о событиях" does
 * not answer that. The lists mirror what lib/alerts computes per role — money
 * appears in none of them, because only the admin may see it at all.
 */
const WHAT_ARRIVES: Record<Role, string> = {
  admin:
    'просроченная уборка, новая бронь от коллеги, совпадение по листу ожидания ' +
    'и скорый приезд гостей в зону отдыха',
  housekeeper: 'номера, где уборка просрочена',
  waiter:
    'скорый приезд гостей в беседку или на топчан — за час до брони — ' +
    'и просроченная уборка в зоне отдыха',
}

/** A browser string is unreadable; this is only to tell two devices apart. */
function deviceName(userAgent: string | null): string {
  if (!userAgent) return 'Неизвестное устройство'
  if (/iPhone/.test(userAgent)) return 'iPhone'
  if (/iPad/.test(userAgent)) return 'iPad'
  if (/Android/.test(userAgent)) return 'Android'
  if (/Windows/.test(userAgent)) return 'Компьютер (Windows)'
  if (/Macintosh/.test(userAgent)) return 'Компьютер (Mac)'
  return 'Другое устройство'
}

function SupportNotice({ support }: { support: PushSupport }) {
  if (support.kind === 'needs-install') {
    return (
      <div className="notice notice-warn">
        <strong>Этому iPhone нужен один шаг.</strong> Safari не отдаёт уведомления обычной
        вкладке — приложение должно быть добавлено на домашний экран. Нажмите{' '}
        <strong>Поделиться</strong> внизу экрана, выберите{' '}
        <strong>«На экран „Домой“»</strong>, затем откройте Taura с домашнего экрана и вернитесь
        сюда. Это ограничение iOS, а не приложения.
      </div>
    )
  }

  if (support.kind === 'unsupported') {
    return (
      <div className="notice notice-warn">
        {support.reason}. Задачи по-прежнему видны на своих страницах и в колокольчике, пока
        приложение открыто.
      </div>
    )
  }

  return null
}

export default function NotificationsPage() {
  const { user } = useAuth()

  const [support] = useState<PushSupport>(() => pushSupport())
  const [permission, setPermission] = useState<NotificationPermission>(() => permissionState())
  const [subscribedHere, setSubscribedHere] = useState<boolean | null>(null)
  const [devices, setDevices] = useState<Device[]>([])
  const [serverReady, setServerReady] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setSubscribedHere((await currentSubscription()) !== null)
    try {
      const [key, list] = await Promise.all([
        api<{ configured: boolean }>('/push/key'),
        api<{ devices: Device[] }>('/push/devices'),
      ])
      setServerReady(key.configured)
      setDevices(list.devices)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить состояние')
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const run = async (action: () => Promise<void>, done: string) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await action()
      setPermission(permissionState())
      await refresh()
      setNotice(done)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не получилось')
    } finally {
      setBusy(false)
    }
  }

  if (subscribedHere === null || serverReady === null) return <Spinner />

  const canSubscribe = support.kind === 'ready' && serverReady

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Уведомления</h1>
          <div className="page-sub">Приходят на это устройство, даже когда приложение закрыто</div>
        </div>
        {subscribedHere && (
          <div className="page-head-actions">
            <button
              className="btn btn-sm"
              disabled={busy}
              onClick={() => void run(sendTestPush, 'Тестовое уведомление отправлено')}
            >
              Проверить
            </button>
          </div>
        )}
      </div>

      {error && <Alert>{error}</Alert>}
      {notice && <div className="notice">{notice}</div>}

      <SupportNotice support={support} />

      {/* Independent of browser support: an admin reading this on a machine
          that cannot do push still needs to know the server half is missing. */}
      {!serverReady && (
        <div className="notice notice-warn">
          Push-уведомления ещё не настроены на сервере. Администратор задаёт секреты{' '}
          <code>VAPID_PUBLIC_KEY</code> и <code>VAPID_PRIVATE_KEY</code>.
        </div>
      )}

      {/* Only meaningful where permission was a thing that could be granted.
          A browser with no Notification API is not "denied" — saying so would
          send someone into browser settings looking for a switch that is not
          there. */}
      {support.kind === 'ready' && permission === 'denied' && (
        <div className="notice notice-warn">
          Уведомления запрещены для этого сайта в настройках браузера. Снять запрет можно только
          там — приложение повторно спросить не может.
        </div>
      )}

      <section className="panel glass" style={{ marginBottom: 16 }}>
        <div className="panel-title">
          Это устройство
          <span className="count">{subscribedHere ? 'уведомления включены' : 'выключены'}</span>
        </div>

        <div className="chip-row">
          {subscribedHere ? (
            <button
              className="btn btn-danger"
              disabled={busy}
              onClick={() => void run(disablePush, 'Уведомления выключены на этом устройстве')}
            >
              Выключить на этом устройстве
            </button>
          ) : (
            <button
              className="btn btn-primary"
              disabled={busy || !canSubscribe}
              onClick={() => void run(enablePush, 'Готово — уведомления придут на это устройство')}
            >
              {busy ? 'Подождите…' : 'Включить уведомления'}
            </button>
          )}
        </div>

        <div className="field-hint" style={{ marginTop: 16 }}>
          Придёт то же, что показывает колокольчик, — {WHAT_ARRIVES[user?.role ?? 'waiter']}.
          Разница в том, что уведомление догонит вас, когда приложение закрыто. Одно событие —
          одно уведомление; если накопилось много, придёт одна общая сводка, а не десять
          отдельных.
        </div>
      </section>

      <section className="panel glass">
        <div className="panel-title">
          Ваши устройства
          <span className="count">{devices.length}</span>
        </div>

        {devices.length === 0 ? (
          <div className="field-hint">
            Ни одного устройства не подключено. Включите уведомления на каждом телефоне, которым
            пользуетесь на смене — они не мешают друг другу.
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Устройство</th>
                <th>Подключено</th>
                <th>Последняя доставка</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((device) => (
                <tr key={device.id}>
                  <td>{deviceName(device.user_agent)}</td>
                  <td>{device.created_at.slice(0, 16)}</td>
                  <td>{device.last_ok_at ? device.last_ok_at.slice(0, 16) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {isIos() && (
          <div className="field-hint" style={{ marginTop: 16 }}>
            На iPhone уведомления привязаны к иконке на домашнем экране. Если удалить иконку,
            устройство отключится само.
          </div>
        )}
      </section>
    </>
  )
}
