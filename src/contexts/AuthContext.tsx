import React, { createContext, useContext, useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { onAuthStateChanged, linkWithPopup } from 'firebase/auth'
import {
  auth,
  googleProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  linkWithRedirect,
  signInAnonymously,
  signOut,
} from '../firebase/config'
import { upsertUser } from '../firebase/db'
import type { AppUser } from '../types'

interface AuthContextValue {
  currentUser: AppUser | null
  loading: boolean
  signInWithGoogle: () => Promise<void>
  signInAsGuest: (displayName: string) => Promise<void>
  upgradeGuestToGoogle: () => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

/** Returns true on iOS or Android — these browsers block popups */
function isMobileBrowser(): boolean {
  return /iphone|ipad|ipod|android/i.test(navigator.userAgent)
}

function firebaseUserToAppUser(user: User, isGuest: boolean): AppUser {
  return {
    uid: user.uid,
    displayName: user.displayName ?? (isGuest ? 'Guest' : user.email ?? 'Unknown'),
    email: user.email,
    isGuest,
    photoURL: user.photoURL,
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // On mobile, after a redirect sign-in we land back here — pick up the result
    getRedirectResult(auth)
      .then(async (result) => {
        if (result?.user) {
          const appUser = firebaseUserToAppUser(result.user, false)
          setCurrentUser(appUser)
          await upsertUser(appUser)
          sessionStorage.removeItem('guestName')
        }
      })
      .catch((err) => {
        // Redirect result errors are non-fatal; log and continue
        console.warn('getRedirectResult error:', err)
      })

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        const isGuest = user.isAnonymous
        // Restore guest display name from session if needed
        const storedName = sessionStorage.getItem('guestName')
        const appUser: AppUser = {
          uid: user.uid,
          displayName: isGuest
            ? (storedName ?? user.displayName ?? 'Guest')
            : (user.displayName ?? user.email ?? 'Unknown'),
          email: user.email,
          isGuest,
          photoURL: user.photoURL,
        }
        setCurrentUser(appUser)
      } else {
        setCurrentUser(null)
      }
      setLoading(false)
    })
    return unsubscribe
  }, [])

  const signInWithGoogle = async () => {
    if (isMobileBrowser()) {
      // Redirect flow — page will reload; result picked up in useEffect above
      await signInWithRedirect(auth, googleProvider)
      return
    }
    const result = await signInWithPopup(auth, googleProvider)
    const appUser = firebaseUserToAppUser(result.user, false)
    setCurrentUser(appUser)
    await upsertUser(appUser)
  }

  const signInAsGuest = async (displayName: string) => {
    const result = await signInAnonymously(auth)
    const appUser: AppUser = {
      uid: result.user.uid,
      displayName: displayName.trim() || 'Guest',
      email: null,
      isGuest: true,
    }
    setCurrentUser(appUser)
    // Store guest name in session so it survives navigations
    sessionStorage.setItem('guestName', appUser.displayName)
  }

  const upgradeGuestToGoogle = async () => {
    if (!auth.currentUser) return
    if (isMobileBrowser()) {
      // Redirect flow — result picked up on return via getRedirectResult
      await linkWithRedirect(auth.currentUser, googleProvider)
      return
    }
    const result = await linkWithPopup(auth.currentUser, googleProvider)
    const appUser = firebaseUserToAppUser(result.user, false)
    setCurrentUser(appUser)
    await upsertUser(appUser)
    sessionStorage.removeItem('guestName')
  }

  const logout = async () => {
    await signOut(auth)
    sessionStorage.removeItem('guestName')
    setCurrentUser(null)
  }

  return (
    <AuthContext.Provider value={{ currentUser, loading, signInWithGoogle, signInAsGuest, upgradeGuestToGoogle, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
