import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { Home, PlusCircle, Clock, LogOut, User } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

export default function Layout() {
  const { currentUser, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  return (
    <div className="flex flex-col min-h-screen max-w-lg mx-auto">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-brand-950 text-white px-4 py-3 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🃏</span>
          <div>
            <span className="font-bold text-lg tracking-tight">Counga</span>
            <span className="ml-1.5 text-xs text-brand-400 font-normal">v{__APP_VERSION__}</span>
          </div>
        </div>
        {currentUser && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-sm text-brand-200">
              {currentUser.photoURL
                ? <img src={currentUser.photoURL} alt="" className="w-6 h-6 rounded-full" />
                : <User size={16} />
              }
              <span className="max-w-[120px] truncate">{currentUser.displayName}</span>
              {currentUser.isGuest && (
                <span className="text-xs bg-brand-700 px-1.5 py-0.5 rounded-full">guest</span>
              )}
            </div>
            <button onClick={handleLogout} className="p-1.5 rounded-lg hover:bg-brand-800 transition-colors" title="Sign out">
              <LogOut size={16} />
            </button>
          </div>
        )}
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto px-4 py-5">
        <Outlet />
      </main>

      {/* Bottom navigation */}
      <nav className="sticky bottom-0 z-50 bg-white border-t border-gray-200 safe-bottom">
        <div className="flex">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center py-2.5 text-xs font-medium gap-1 transition-colors ${
                isActive ? 'text-brand-600' : 'text-gray-500 hover:text-gray-700'
              }`
            }
          >
            <Home size={20} />
            <span>Home</span>
          </NavLink>
          <NavLink
            to="/new-game"
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center py-2.5 text-xs font-medium gap-1 transition-colors ${
                isActive ? 'text-brand-600' : 'text-gray-500 hover:text-gray-700'
              }`
            }
          >
            <PlusCircle size={20} />
            <span>New Game</span>
          </NavLink>
          <NavLink
            to="/history"
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center py-2.5 text-xs font-medium gap-1 transition-colors ${
                isActive ? 'text-brand-600' : 'text-gray-500 hover:text-gray-700'
              }`
            }
          >
            <Clock size={20} />
            <span>History</span>
          </NavLink>
        </div>
      </nav>
    </div>
  )
}
