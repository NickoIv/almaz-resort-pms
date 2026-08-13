import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { api, getToken, onSessionLost, setToken } from './api'
import type { Role, StaffUser } from './types'

type AuthState = {
  user: StaffUser | null
  loading: boolean
  /** Сессию оборвал сервер, а не человек — экрану входа есть что объяснить. */
  expired: boolean
  login: (phone: string, pin: string) => Promise<StaffUser>
  logout: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<StaffUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [expired, setExpired] = useState(false)

  /**
   * Двенадцатичасовой токен переживает смену, но не ночь, а вкладку на стойке
   * никто не закрывает. Пока это никого не касалось, приложение утром выглядело
   * сломанным: имя администратора в шапке, работающее меню и «Missing bearer
   * token» на каждой странице — потому что `user` жил в памяти и после того, как
   * токен убрали. Теперь конец сессии снимает пользователя, а `RequireRole`
   * уводит на PIN-код, то есть туда, где это чинится.
   */
  useEffect(
    () =>
      onSessionLost(() => {
        setExpired(true)
        setUser(null)
      }),
    []
  )

  // Restore the session from the stored token on a hard refresh.
  useEffect(() => {
    if (!getToken()) {
      setLoading(false)
      return
    }
    api<{ user: StaffUser }>('/auth/me')
      .then(({ user: restored }) => setUser(restored))
      .catch(() => {
        setToken(null)
        setUser(null)
      })
      .finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (phone: string, pin: string) => {
    const result = await api<{ token: string; user: StaffUser }>('/auth/login', {
      method: 'POST',
      body: { phone, pin },
    })
    setToken(result.token)
    setUser(result.user)
    setExpired(false)
    return result.user
  }, [])

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
    // Ушли сами — объяснять на экране входа нечего.
    setExpired(false)
  }, [])

  const value = useMemo(
    () => ({ user, loading, expired, login, logout }),
    [user, loading, expired, login, logout]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}

/**
 * Where each role lands after logging in.
 *
 * The admin gets the summary; the other two go straight to the one page they
 * work in, where a dashboard would only be a detour.
 */
export const HOME_BY_ROLE: Record<Role, string> = {
  admin: '/',
  housekeeper: '/cleaning',
  waiter: '/restaurant',
}

function Splash() {
  return (
    <div className="splash">
      <div className="spinner" />
    </div>
  )
}

/** Blocks anonymous visitors and, optionally, the wrong roles. */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <Splash />
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  if (!roles.includes(user.role)) return <Navigate to={HOME_BY_ROLE[user.role]} replace />

  return <>{children}</>
}