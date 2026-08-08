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
import { api, getToken, setToken } from './api'
import type { Role, StaffUser } from './types'

type AuthState = {
  user: StaffUser | null
  loading: boolean
  login: (phone: string, pin: string) => Promise<StaffUser>
  logout: () => void
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<StaffUser | null>(null)
  const [loading, setLoading] = useState(true)

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
    return result.user
  }, [])

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
  }, [])

  const value = useMemo(() => ({ user, loading, login, logout }), [user, loading, login, logout])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}

/** Where each role lands after logging in. */
export const HOME_BY_ROLE: Record<Role, string> = {
  admin: '/rooms',
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