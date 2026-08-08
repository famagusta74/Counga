import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import Layout from './components/Layout'
import HomePage from './pages/HomePage'
import LoginPage from './pages/LoginPage'
import NewGamePage from './pages/NewGamePage'
import GamePage from './pages/GamePage'
import HistoryPage from './pages/HistoryPage'
import { useAuth } from './contexts/AuthContext'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { currentUser, loading } = useAuth()
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-600" />
    </div>
  )
  if (!currentUser) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename="/Counga">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<Layout />}>
            <Route path="/" element={
              <RequireAuth><HomePage /></RequireAuth>
            } />
            <Route path="/new-game" element={
              <RequireAuth><NewGamePage /></RequireAuth>
            } />
            <Route path="/game/:gameId" element={
              <RequireAuth><GamePage /></RequireAuth>
            } />
            <Route path="/history" element={
              <RequireAuth><HistoryPage /></RequireAuth>
            } />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
