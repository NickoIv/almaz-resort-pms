import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth'
import { ROLE_LABELS, type Role } from '../types'

type NavItem = { to: string; label: string; roles: Role[] }

const NAV: NavItem[] = [
  { to: '/rooms', label: 'Номера', roles: ['admin'] },
  { to: '/cleaning', label: 'Уборка', roles: ['admin', 'housekeeper'] },
  { to: '/restaurant', label: 'Зона отдыха', roles: ['admin', 'waiter'] },
  { to: '/analytics', label: 'Аналитика', roles: ['admin'] },
  { to: '/audit', label: 'Журнал', roles: ['admin'] },
  { to: '/settings', label: 'Настройки', roles: ['admin'] },
]

export default function AppShell() {
  const { user, logout } = useAuth()
  if (!user) return null

  const items = NAV.filter((item) => item.roles.includes(user.role))

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">◈</span>
          <span>
            Almaz Resort
            <span className="brand-sub"> · PMS</span>
          </span>
        </div>

        <nav className="nav">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => (isActive ? 'active' : undefined)}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="topbar-right">
          <div className="who">
            <div className="who-name">{user.name}</div>
            <div className="who-role">{ROLE_LABELS[user.role]}</div>
          </div>
          <button className="btn btn-sm btn-ghost" onClick={logout}>
            Выйти
          </button>
        </div>
      </header>

      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}