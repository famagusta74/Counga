import React, { createContext, useContext, useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { onAuthStateChanged, linkWithPopup } from 'firebase/auth'
import {
  auth,
  googleProvider,
  signInWithPopup,
  getRedirectResult,
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
    let authStateResolved = false
    let redirectResolved  = false

    const trySetLoaded = () => {
      if (authStateResolved && redirectResolved) setLoading(false)
    }

    // Consume any pending redirect result (shouldn't be one since we use popup now,
    // but keeps the gate symmetric so loading clears correctly)
    getRedirectResult(auth)
      .catch(() => { /* ignore */ })
      .finally(() => { redirectResolved = true; trySetLoaded() })

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        const isGuest = user.isAnonymous
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
      authStateResolved = true
      trySetLoaded()
    })

    return unsubscribe
  }, [])

  // signInWithPopup works on iOS when called directly from a user-gesture handler.
  // signInWithRedirect is broken on all iOS browsers (WebKit ITP blocks the
  // cross-origin state cookie Firebase depends on).
  const signInWithGoogle = async () => {
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
    sessionStorage.setItem('guestName', appUser.displayName)
  }

  const upgradeGuestToGoogle = async () => {
    if (!auth.currentUser) return
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
