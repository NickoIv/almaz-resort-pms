import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth'
import AlmatyClock from './AlmatyClock'
import ReviewsLink from './ReviewsLink'
import { ROLE_LABELS, type Role } from '../types'

type NavItem = { to: string; label: string; roles: Role[] }
type NavGroup = { label: string; items: NavItem[] }

/**
 * The sidebar, in three groups.
 *
 * Eight flat links gave no clue which of them belong together; grouping them
 * by what the person is doing — running the day, reading it back, changing how
 * it works — means a housekeeper never scans past six admin links to find the
 * one page they use.
 *
 * A group whose items are all filtered out by role disappears with them, so
 * nobody sees an empty "Отчёты" heading.
 */
const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Работа',
    items: [
      { to: '/rooms', label: 'Номера', roles: ['admin'] },
      { to: '/restaurant', label: 'Зона отдыха', roles: ['admin', 'waiter'] },
      { to: '/cleaning', label: 'Уборка', roles: ['admin', 'housekeeper'] },
      { to: '/waitlist', label: 'Ожидание', roles: ['admin'] },
    ],
  },
  {
    label: 'Отчёты',
    items: [
      { to: '/analytics', label: 'Аналитика', roles: ['admin'] },
      { to: '/audit', label: 'Журнал', roles: ['admin'] },
    ],
  },
  {
    label: 'Управление',
    items: [
      { to: '/staff', label: 'Персонал', roles: ['admin'] },
      { to: '/settings', label: 'Настройки', roles: ['admin'] },
    ],
  },
]

const linkClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? 'nav-link active' : 'nav-link'

export default function AppShell() {
  const { user, logout } = useAuth()
  if (!user) return null

  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.roles.includes(user.role)),
  })).filter((group) => group.items.length > 0)

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">◈</span>
          <span>
            Taura
            <span className="brand-sub"> · PMS</span>
          </span>
        </div>

        <div className="topbar-right">
          <ReviewsLink />
          <AlmatyClock />
          <div className="who">
            <div className="who-name">{user.name}</div>
            <div className="who-role">{ROLE_LABELS[user.role]}</div>
          </div>
          <button className="btn btn-sm btn-ghost" onClick={logout}>
            Выйти
          </button>
        </div>
      </header>

      <div className="shell-body">
        <nav className="sidebar" aria-label="Разделы">
          {user.role === 'admin' && (
            <NavLink to="/" end className={linkClass}>
              Сводка
            </NavLink>
          )}

          {groups.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-group-label">{group.label}</div>
              {group.items.map((item) => (
                <NavLink key={item.to} to={item.to} className={linkClass}>
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
