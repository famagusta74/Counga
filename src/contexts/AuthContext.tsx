import React, { createContext, useContext, useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { onAuthStateChanged } from 'firebase/auth'
import {
  auth,
  googleProvider,
  signInWithPopup,
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
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        const isGuest = user.isAnonymous
        const appUser = firebaseUserToAppUser(user, isGuest)
        setCurrentUser(appUser)
      } else {
        setCurrentUser(null)
      }
      setLoading(false)
    })
    return unsubscribe
  }, [])

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
    // Store guest name in session so it survives navigations
    sessionStorage.setItem('guestName', appUser.displayName)
  }

  const logout = async () => {
    await signOut(auth)
    sessionStorage.removeItem('guestName')
    setCurrentUser(null)
  }

  return (
    <AuthContext.Provider value={{ currentUser, loading, signInWithGoogle, signInAsGuest, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
