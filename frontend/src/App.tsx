import { Navigate, Route, Routes } from 'react-router-dom'
import { RequireRole, useAuth, HOME_BY_ROLE } from './auth'
import AppShell from './components/AppShell'
import { Spinner } from './components/ui'
import AnalyticsPage from './pages/AnalyticsPage'
import CleaningPage from './pages/CleaningPage'
import LoginPage from './pages/LoginPage'
import RestaurantPage from './pages/RestaurantPage'
import RoomDetailPage from './pages/RoomDetailPage'
import RoomsPage from './pages/RoomsPage'
import SettingsPage from './pages/SettingsPage'

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
              <RoomDetailPage />
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
          path="/settings"
          element={
            <RequireRole roles={['admin']}>
              <SettingsPage />
            </RequireRole>
          }
        />
      </Route>

      <Route path="*" element={<RoleHome />} />
    </Routes>
  )
}