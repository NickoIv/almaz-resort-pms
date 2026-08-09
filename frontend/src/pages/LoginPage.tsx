import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { HOME_BY_ROLE, useAuth } from '../auth'
import MountainRidge from '../components/MountainRidge'
import { Alert, Spinner } from '../components/ui'

export default function LoginPage() {
  const { user, loading, login } = useAuth()
  const navigate = useNavigate()

  const [phone, setPhone] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (loading) return <Spinner />
  if (user) return <Navigate to={HOME_BY_ROLE[user.role]} replace />

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const staff = await login(phone, pin)
      navigate(HOME_BY_ROLE[staff.role], { replace: true })
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