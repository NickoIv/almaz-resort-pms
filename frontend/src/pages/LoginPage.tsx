import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { HOME_BY_ROLE, useAuth } from '../auth'
import MountainRidge from '../components/MountainRidge'
import { Alert, Spinner } from '../components/ui'

export default function LoginPage() {
  const { user, loading, expired, login } = useAuth()
  const navigate = useNavigate()
  // Куда человек смотрел, когда сессия кончилась. `RequireRole` кладёт это сюда,
  // и вернуть туда же дешевле, чем заставлять искать страницу заново.
  const from = (useLocation().state as { from?: string } | null)?.from

  const [phone, setPhone] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (loading) return <Spinner />
  // Этот возврат срабатывает раньше `navigate` в обработчике — как только
  // появился пользователь, страница уже уходит. Значит, знать про `from` должен
  // именно он, иначе вернуться на прежнюю страницу не выйдет никогда.
  if (user) return <Navigate to={from ?? HOME_BY_ROLE[user.role]} replace />

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const staff = await login(phone, pin)
      // Если роль эту страницу не открывает, охрана маршрута всё равно отправит
      // на домашнюю — так что вернуть можно смело.
      navigate(from ?? HOME_BY_ROLE[staff.role], { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось войти')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-wrap">
      {/* The one piece of imagery in the app, and the only place the serif
          survives — here it is a wordmark, not an interface element. */}
      <MountainRidge className="ridge-login" />

      <form className="login-card glass" onSubmit={handleSubmit}>
        <div className="login-logo">◈</div>
        <h1 className="login-wordmark">Taura</h1>
        <div className="page-sub">PMS · вход для персонала</div>

        {error && <Alert>{error}</Alert>}

        {/* Сказать «вход держится смену» здесь — единственный момент, когда это
            и уместно, и полезно: иначе утренний PIN выглядит как то, что
            приложение забыло вчерашний вход просто так. */}
        {expired && !error && (
          <div className="notice">
            Вход действует одну смену — за ночь он закончился. Введите PIN-код ещё раз.
          </div>
        )}

        <div className="field">
          <label htmlFor="phone">Телефон</label>
          <input
            id="phone"
            type="tel"
            autoComplete="username"
            placeholder="+7 701 111 22 33"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="pin">PIN-код</label>
          <input
            id="pin"
            className="pin-input"
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            placeholder="••••"
            value={pin}
            onChange={(event) => setPin(event.target.value)}
            required
          />
        </div>

        <button className="btn btn-primary" type="submit" disabled={submitting}>
          {submitting ? 'Вход…' : 'Войти'}
        </button>

        <div className="hint">
          Доступ выдаёт администратор. Если PIN не подходит или учётная запись отключена —
          обратитесь к нему.
        </div>
      </form>
    </div>
  )
}