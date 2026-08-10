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

/**
 * The sections that get a tab at the bottom of a phone.
 *
 * Only what someone is in all shift. Everything else lives behind «Ещё»,
 * which is the whole point: moving between the pages of the actual work used
 * to mean reaching the top of the screen, opening the menu, scrolling it and
 * tapping — with the page jumping 639px underneath. Four destinations at most,
 * because a fifth makes the labels too narrow to read at 390px.
 */
const TAB_ICONS: Record<string, string> = {
  '/': '◈',
  '/rooms': '▦',
  '/restaurant': '☂',
  '/cleaning': '✦',
  '/notifications': '◔',
}

/**
 * Shorter names for the bar, where five labels share 390px. Only where the
 * full one does not fit — a tab that says «Зона отд…» is worse than one that
 * says «Отдых», because a truncation looks like a fault.
 */
const TAB_LABELS: Record<string, string> = { '/restaurant': 'Отдых', '/notifications': 'Сигналы' }

function primaryTabs(role: Role): NavItem[] {
  const work = NAV_GROUPS[0].items.filter((item) => item.roles.includes(role))
  const dashboard: NavItem[] =
    role === 'admin' ? [{ to: '/', label: 'Сводка', roles: ['admin'] }] : []
  // Housekeepers and waiters have one work page each, so notifications — the
  // one thing they must reach on their own phone — earns the second tab.
  const own: NavItem[] =
    role === 'admin'
      ? []
      : [{ to: '/notifications', label: 'Уведомления', roles: [role] }]
  return [...dashboard, ...work, ...own].slice(0, 4)
}

/**
 * Whether we are at phone width.
 *
 * The account controls have to *move* between the topbar and the menu sheet
 * rather than exist in both and be hidden with CSS: two copies means a screen
 * reader announcing two «Выйти» buttons and two review links, and a test
 * finding both. CSS cannot move an element, so this is the one thing the
 * layout asks JavaScript about.
 */
const PHONE_QUERY = '(max-width: 640px)'

/** Guarded: jsdom has no matchMedia, and a throw here takes the whole shell
 *  down rather than degrading to the desktop layout. */
function phoneNow(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(PHONE_QUERY).matches
    : false
}

function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState(phoneNow)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(PHONE_QUERY)
    const update = () => setIsPhone(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return isPhone
}

export default function AppShell() {
  const { user, logout } = useAuth()
  const location = useLocation()
  const isPhone = useIsPhone()

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
          <AlmatyClock />
          {/* On a phone these move into the menu sheet — see useIsPhone. They
              cost a third of a 153px topbar and are touched once a shift. */}
          {!isPhone && (
            <>
              <ReviewsLink />
              <ThemeToggle />
              <div className="who">
                <div className="who-name">{user.name}</div>
                <div className="who-role">{ROLE_LABELS[user.role]}</div>
              </div>
              <button className="btn btn-sm btn-ghost" onClick={logout}>
                Выйти
              </button>
            </>
          )}
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

          {/* Who you are, how it looks, and the way out — moved off the phone's
              topbar, where they cost a third of its 153px and were read once a
              shift. */}
          {isPhone && (
          <div className="nav-account">
            <div className="who">
              <div className="who-name">{user.name}</div>
              <div className="who-role">{ROLE_LABELS[user.role]}</div>
            </div>
            <div className="nav-account-actions">
              <ThemeToggle />
              <ReviewsLink />
              <button className="btn btn-sm" onClick={logout}>
                Выйти
              </button>
            </div>
          </div>
          )}
        </nav>

        {/* Keyed on the path so React remounts it per route, which is what
            restarts the fade. The animation itself is CSS, and stops dead
            under prefers-reduced-motion. */}
        <main className="content" key={location.pathname}>
          <Outlet />
        </main>
      </div>

      {/* Phone only, and rendered rather than merely hidden: above 640px the
          sidebar is always on screen, and a second set of links to the same
          places would be read out twice by a screen reader. */}
      {isPhone && (
      <nav className="mobile-tabs" aria-label="Основные разделы">
        {primaryTabs(user.role).map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) => `mobile-tab ${isActive ? 'active' : ''}`}
          >
            <span className="mobile-tab-icon" aria-hidden="true">
              {TAB_ICONS[item.to] ?? '•'}
            </span>
            <span className="mobile-tab-label">{TAB_LABELS[item.to] ?? item.label}</span>
          </NavLink>
        ))}
        <button
          type="button"
          className={`mobile-tab ${navOpen ? 'active' : ''}`}
          aria-expanded={navOpen}
          aria-controls="app-nav"
          onClick={() => setNavOpen((open) => !open)}
        >
          <span className="mobile-tab-icon" aria-hidden="true">
            ☰
          </span>
          <span className="mobile-tab-label">Ещё</span>
        </button>
      </nav>
      )}
    </div>
  )
}
