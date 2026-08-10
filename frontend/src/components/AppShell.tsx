import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth'
import AlertCenter from './AlertCenter'
import AlmatyClock from './AlmatyClock'
import ReviewsLink from './ReviewsLink'
import ThemeToggle from './ThemeToggle'
import { unlockSound } from '../sound'
import { useAlerts } from '../useAlerts'
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
      // Every role, unlike the rest of this group: notifications are switched
      // on per person and per phone, so a housekeeper has to reach this herself.
      { to: '/notifications', label: 'Уведомления', roles: ['admin', 'housekeeper', 'waiter'] },
      { to: '/staff', label: 'Персонал', roles: ['admin'] },
      { to: '/settings', label: 'Настройки', roles: ['admin'] },
    ],
  },
]

const linkClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? 'nav-link active' : 'nav-link'

export default function AppShell() {
  const { user, logout } = useAuth()
  const location = useLocation()

  /**
   * Whether the nav is open on a phone.
   *
   * Above 640px this does nothing: the sidebar is a column on a desktop and a
   * horizontal strip on a tablet, and both are always visible. At phone width
   * that strip wrapped onto five rows and pushed the actual page below the
   * fold — someone opening Уборка had to scroll past every other section to
   * reach their own work.
   */
  const [navOpen, setNavOpen] = useState(false)

  // Browsers refuse to make a sound until the page has been interacted with.
  // One silent unlock on the first click or keypress after login is enough for
  // the rest of the session; { once: true } takes the listener straight back
  // off again.
  useEffect(() => {
    const unlock = () => unlockSound()
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  // Following a link should put the page back, not leave the menu covering it.
  useEffect(() => setNavOpen(false), [location.pathname])

  // Hooks must run before the early return, so the role is read defensively.
  const { alerts, acknowledge, acknowledgeAll } = useAlerts()

  if (!user) return null

  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.roles.includes(user.role)),
  })).filter((group) => group.items.length > 0)

  return (
    <div className="shell">
      <header className="topbar">
        {/* Phone only — see the media query. Kept in the DOM at every width so
            the button's state is not lost when the viewport is resized. */}
        <button
          type="button"
          className="nav-toggle"
          aria-expanded={navOpen}
          aria-controls="app-nav"
          aria-label={navOpen ? 'Скрыть разделы' : 'Показать разделы'}
          onClick={() => setNavOpen((open) => !open)}
        >
          <span aria-hidden="true">{navOpen ? '✕' : '☰'}</span>
        </button>

        <div className="brand">
          <span className="brand-mark">◈</span>
          <span>
            Taura
            <span className="brand-sub"> · PMS</span>
          </span>
        </div>

        <div className="topbar-right">
          <AlertCenter
            alerts={alerts}
            onAcknowledge={acknowledge}
            onAcknowledgeAll={acknowledgeAll}
          />
          <ReviewsLink />
          <AlmatyClock />
          <ThemeToggle />
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
        <nav id="app-nav" className={`sidebar ${navOpen ? 'open' : ''}`} aria-label="Разделы">
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

        {/* Keyed on the path so React remounts it per route, which is what
            restarts the fade. The animation itself is CSS, and stops dead
            under prefers-reduced-motion. */}
        <main className="content" key={location.pathname}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
