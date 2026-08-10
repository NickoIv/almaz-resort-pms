import { Navigate, Route, Routes } from 'react-router-dom'
import { RequireRole, useAuth, HOME_BY_ROLE } from './auth'
import AppShell from './components/AppShell'
import { Spinner } from './components/ui'
import AnalyticsPage from './pages/AnalyticsPage'
import AuditPage from './pages/AuditPage'
import CleaningPage from './pages/CleaningPage'
import DashboardPage from './pages/DashboardPage'
import LoginPage from './pages/LoginPage'
import NotificationsPage from './pages/NotificationsPage'
import RestaurantPage from './pages/RestaurantPage'
import RoomsPage from './pages/RoomsPage'
import UnitDetailPage from './pages/UnitDetailPage'
import SettingsPage from './pages/SettingsPage'
import StaffPage from './pages/StaffPage'
import WaitlistPage from './pages/WaitlistPage'

/** Sends a signed-in user to their role's dashboard, everyone else to /login. */
function RoleHome() {
  const { user, loading } = useAuth()
  if (loading) return <Spinner />
  return <Navigate to={user ? HOME_BY_ROLE[user.role] : '/login'} replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        element={
          <RequireRole roles={['admin', 'housekeeper', 'waiter']}>
            <AppShell />
          </RequireRole>
        }
      >
        {/* The admin lands on the summary; RequireRole bounces the other two
            roles straight back to the single page they actually work in. */}
        <Route
          index
          element={
            <RequireRole roles={['admin']}>
              <DashboardPage />
            </RequireRole>
          }
        />
        <Route
          path="/rooms"
          element={
            <RequireRole roles={['admin']}>
              <RoomsPage />
            </RequireRole>
          }
        />
        <Route
          path="/rooms/:id"
          element={
            <RequireRole roles={['admin']}>
              <UnitDetailPage />
            </RequireRole>
          }
        />
        {/* Same detail view for recreation units; waiters reach it too, and the
            API keeps them out of anything that is not restaurant/recreation. */}
        <Route
          path="/units/:id"
          element={
            <RequireRole roles={['admin', 'waiter']}>
              <UnitDetailPage />
            </RequireRole>
          }
        />
        <Route
          path="/cleaning"
          element={
            <RequireRole roles={['admin', 'housekeeper']}>
              <CleaningPage />
            </RequireRole>
          }
        />
        <Route
          path="/restaurant"
          element={
            <RequireRole roles={['admin', 'waiter']}>
              <RestaurantPage />
            </RequireRole>
          }
        />
        <Route
          path="/analytics"
          element={
            <RequireRole roles={['admin']}>
              <AnalyticsPage />
            </RequireRole>
          }
        />
        <Route
          path="/audit"
          element={
            <RequireRole roles={['admin']}>
              <AuditPage />
            </RequireRole>
          }
        />
        <Route
          path="/waitlist"
          element={
            <RequireRole roles={['admin']}>
              <WaitlistPage />
            </RequireRole>
          }
        />
        <Route
          path="/staff"
          element={
            <RequireRole roles={['admin']}>
              <StaffPage />
            </RequireRole>
          }
        />
        <Route
          path="/settings"
          element={
            <RequireRole roles={['admin']}>
              <SettingsPage />
            </RequireRole>
          }
        />
        {/* Open to all three roles: each person switches on their own phone. */}
        <Route
          path="/notifications"
          element={
            <RequireRole roles={['admin', 'housekeeper', 'waiter']}>
              <NotificationsPage />
            </RequireRole>
          }
        />
      </Route>

      <Route path="*" element={<RoleHome />} />
    </Routes>
  )
}