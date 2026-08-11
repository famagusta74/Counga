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
  // Start as true — stays true until BOTH getRedirectResult AND onAuthStateChanged resolve
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let authStateResolved = false
    let redirectResolved  = false

    // Mark loading done only when both have resolved
    const trySetLoaded = () => {
      if (authStateResolved && redirectResolved) setLoading(false)
    }

    // 1. Pick up any pending redirect result (mobile Google sign-in return)
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
        console.warn('getRedirectResult error:', err)
      })
      .finally(() => {
        redirectResolved = true
        trySetLoaded()
      })

    // 2. Subscribe to auth state changes
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

  const signInWithGoogle = async () => {
    if (isMobileBrowser()) {
      // Redirect flow — page navigates to Google then back.
      // getRedirectResult() in useEffect above picks up the result on return.
      await signInWithRedirect(auth, googleProvider)
      return   // page is leaving; nothing after this runs
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
    sessionStorage.setItem('guestName', appUser.displayName)
  }

  const upgradeGuestToGoogle = async () => {
    if (!auth.currentUser) return
    if (isMobileBrowser()) {
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
