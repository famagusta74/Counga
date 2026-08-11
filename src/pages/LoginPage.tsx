import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { LogIn, User } from 'lucide-react'

export default function LoginPage() {
  const { currentUser, loading: authLoading, signInWithGoogle, signInAsGuest } = useAuth()
  const navigate = useNavigate()

  const [guestName, setGuestName]   = useState('')
  const [googleBusy, setGoogleBusy] = useState(false)
  const [guestBusy, setGuestBusy]   = useState(false)
  const [error, setError]           = useState('')

  // Redirect once authenticated
  useEffect(() => {
    if (currentUser) navigate('/', { replace: true })
  }, [currentUser, navigate])

  // Show spinner while Firebase resolves initial auth state
  if (authLoading) {
    return (
      <div className="min-h-screen bg-brand-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-white" />
          <p className="text-brand-300 text-sm">Signing you in…</p>
        </div>
      </div>
    )
  }

  const handleGoogle = async () => {
    // IMPORTANT: signInWithPopup must be the FIRST thing called — no await, no
    // setState before it. iOS WebKit closes the popup if a microtask runs first.
    setError('')
    setGoogleBusy(true)
    try {
      await signInWithGoogle()
      navigate('/', { replace: true })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      // auth/popup-blocked = popup was blocked by the browser
      if (msg.includes('popup-blocked') || msg.includes('popup_blocked')) {
        setError('Pop-up was blocked. Please allow pop-ups for this site in your browser settings, then try again.')
      } else if (msg.includes('popup-closed-by-user') || msg.includes('popup_closed')) {
        setError('Sign-in window was closed. Please try again.')
      } else {
        setError('Google sign-in failed: ' + msg)
      }
      console.error(e)
    } finally {
      setGoogleBusy(false)
    }
  }

  const handleGuest = async () => {
    const name = guestName.trim() || 'Guest'
    setError('')
    setGuestBusy(true)
    try {
      await signInAsGuest(name)
      navigate('/', { replace: true })
    } catch (e: unknown) {
      console.error(e)
      setError('Could not create guest session. Check Firebase configuration.')
    } finally {
      setGuestBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-brand-950 flex flex-col items-center justify-center px-6 py-12">

      {/* Logo */}
      <div className="text-center mb-10">
        <div className="text-6xl mb-4">🃏</div>
        <h1 className="text-3xl font-bold text-white tracking-tight">Counga</h1>
        <p className="text-brand-300 mt-2 text-sm">Family &amp; friends score tracker</p>
        <p className="text-brand-500 text-xs mt-1">v{__APP_VERSION__}</p>
      </div>

      <div className="w-full max-w-sm space-y-4">

        {/* Google Sign In */}
        <div className="card space-y-3">
          <p className="text-xs text-gray-500">
            Sign in to save your game history across devices.
          </p>
          <button
            onClick={handleGoogle}
            disabled={googleBusy || guestBusy}
            className="btn-primary w-full py-3.5 text-base"
          >
            {googleBusy ? (
              <span className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
            ) : (
              <>
                <svg viewBox="0 0 24 24" className="w-5 h-5 flex-shrink-0">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Continue with Google
              </>
            )}
          </button>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <hr className="flex-1 border-brand-800" />
          <span className="text-xs text-brand-500">or play as guest</span>
          <hr className="flex-1 border-brand-800" />
        </div>

        {/* Guest Sign In */}
        <div className="card space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
            <User size={16} className="text-gray-500" />
            Play as Guest
          </div>
          <p className="text-xs text-gray-500">
            No sign-up required. History is not saved between sessions.
          </p>
          <input
            type="text"
            value={guestName}
            onChange={e => setGuestName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleGuest()}
            placeholder="Your name (optional)"
            className="input"
            maxLength={30}
            disabled={googleBusy || guestBusy}
          />
          <button
            onClick={handleGuest}
            disabled={googleBusy || guestBusy}
            className="btn-secondary w-full py-3"
          >
            {guestBusy ? (
              <span className="animate-spin rounded-full h-5 w-5 border-b-2 border-gray-600" />
            ) : (
              <><LogIn size={16} /> Play as Guest</>
            )}
          </button>
        </div>

        {error && (
          <div className="text-sm text-red-300 bg-red-900/30 rounded-xl px-4 py-3 text-center space-y-1">
            <p>{error}</p>
            <p className="text-xs text-red-400 mt-1">
              If the problem persists, try the Guest option below.
            </p>
          </div>
        )}
      </div>

      <p className="text-brand-600 text-xs mt-10 text-center">
        Counga · Built for family fun 🎴
      </p>
    </div>
  )
}
