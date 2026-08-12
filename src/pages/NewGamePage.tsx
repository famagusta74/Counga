import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { createGame, getActiveGameForUser, abandonGame, getGroup, searchUsersByName } from '../firebase/db'
import type { Player, Game, UserSearchResult } from '../types'
import { Plus, Trash2, Users, Target, LogIn, AlertTriangle, ArrowRight, Search } from 'lucide-react'

export default function NewGamePage() {
  const { currentUser } = useAuth()
  const navigate = useNavigate()
  const location  = useLocation()
  // If navigated from Groups page, state contains { groupId, groupName }
  const groupState = location.state as { groupId?: string; groupName?: string } | null

  const [targetScore, setTargetScore] = useState(200)
  const [playerName, setPlayerName] = useState('')
  const [players, setPlayers] = useState<Player[]>(() =>
    currentUser ? [{
      uid: currentUser.uid,
      displayName: currentUser.displayName,
      isGuest: currentUser.isGuest,
    }] : []
  )
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState('')

  // Active game gate
  const [activeGame, setActiveGame] = useState<Game | null>(null)
  const [showActiveModal, setShowActiveModal] = useState(false)
  const [abandoning, setAbandoning] = useState(false)

  // User search (for verified player autocomplete)
  const [searchResults, setSearchResults]   = useState<UserSearchResult[]>([])
  const [searching, setSearching]           = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)

  // If came from a group, auto-load group members
  useEffect(() => {
    if (!groupState?.groupId || !currentUser) return
    getGroup(groupState.groupId).then(group => {
      if (!group) return
      // Build player list from memberUids — use uid as display name placeholder,
      // we'll use the displayName from current user for self
      const groupPlayers: Player[] = group.memberUids.map(uid => ({
        uid,
        displayName: uid === currentUser.uid ? currentUser.displayName : uid,
        isGuest: uid === currentUser.uid ? currentUser.isGuest : false,
      }))
      setPlayers(groupPlayers)
    })
  }, [groupState?.groupId, currentUser])

  // Search verified users as player name is typed
  useEffect(() => {
    if (!playerName.trim() || playerName.length < 2 || currentUser?.isGuest) {
      setSearchResults([])
      setShowSuggestions(false)
      return
    }
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const results = await searchUsersByName(playerName)
        const existingUids = new Set(players.map(p => p.uid))
        const filtered = results.filter(r => !existingUids.has(r.uid))
        setSearchResults(filtered)
        setShowSuggestions(filtered.length > 0)
      } finally {
        setSearching(false)
      }
    }, 350)
    return () => clearTimeout(t)
  }, [playerName, players, currentUser])

  // Check for existing active game on mount
  useEffect(() => {
    if (!currentUser || currentUser.isGuest) { setChecking(false); return }
    getActiveGameForUser(currentUser.uid)
      .then(game => {
        if (game) {
          setActiveGame(game)
          setShowActiveModal(true)
        }
      })
      .finally(() => setChecking(false))
  }, [currentUser])

  const handleResume = () => {
    if (activeGame) navigate(`/game/${activeGame.id}`)
  }

  const handleAbandon = async () => {
    if (!activeGame) return
    setAbandoning(true)
    try {
      await abandonGame(activeGame.id)
      setActiveGame(null)
      setShowActiveModal(false)
    } finally {
      setAbandoning(false)
    }
  }

  /** Add a verified (Google) user from search results */
  const addVerifiedPlayer = (user: UserSearchResult) => {
    if (players.some(p => p.uid === user.uid)) return
    setPlayers(prev => [...prev, { uid: user.uid, displayName: user.displayName, isGuest: false }])
    setPlayerName('')
    setSearchResults([])
    setShowSuggestions(false)
    setError('')
  }

  const addPlayer = () => {
    const name = playerName.trim()
    if (!name) return
    if (players.some(p => p.displayName.toLowerCase() === name.toLowerCase())) {
      setError('A player with that name already exists.')
      return
    }
    const uid = `guest_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    setPlayers(prev => [...prev, { uid, displayName: name, isGuest: true }])
    setPlayerName('')
    setSearchResults([])
    setShowSuggestions(false)
    setError('')
  }

  const removePlayer = (uid: string) => {
    if (uid === currentUser?.uid) return
    setPlayers(prev => prev.filter(p => p.uid !== uid))
  }

  const handleStart = async () => {
    // If there's an unsaved name in the input, add it before starting
    let finalPlayers = players
    const pendingName = playerName.trim()
    if (pendingName) {
      if (players.some(p => p.displayName.toLowerCase() === pendingName.toLowerCase())) {
        setError(`"${pendingName}" is already in the player list.`)
        return
      }
      const uid = `guest_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
      const newPlayer = { uid, displayName: pendingName, isGuest: true }
      finalPlayers = [...players, newPlayer]
      setPlayers(finalPlayers)
      setPlayerName('')
    }

    if (finalPlayers.length < 2) { setError('You need at least 2 players.'); return }
    if (targetScore < 10)        { setError('Target score must be at least 10.'); return }
    setLoading(true)
    try {
      const gameId = await createGame(targetScore, finalPlayers)
      navigate(`/game/${gameId}`)
    } catch (e) {
      console.error(e)
      setError('Failed to create game. Check your Firebase configuration.')
    } finally {
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-600" />
      </div>
    )
  }

  return (
    <div className="space-y-5 pb-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">New Game</h1>
        <p className="text-sm text-gray-500 mt-1">
          {groupState?.groupName
            ? <span>From group: <strong>{groupState.groupName}</strong></span>
            : 'Set up a fresh Counga session'
          }
        </p>
      </div>

      {/* Target Score */}
      <div className="card space-y-3">
        <div className="flex items-center gap-2 text-brand-700 font-semibold">
          <Target size={18} />
          <span>Target Score</span>
        </div>
        <p className="text-xs text-gray-500">
          The game ends when any player reaches this many points. Lowest total wins.
        </p>
        <div className="flex gap-2 flex-wrap">
          {[100, 150, 200, 300, 500].map(val => (
            <button
              key={val}
              onClick={() => setTargetScore(val)}
              className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${
                targetScore === val
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-white text-gray-700 border-gray-200 hover:border-brand-300'
              }`}
            >
              {val}
            </button>
          ))}
          <input
            type="number"
            value={targetScore}
            min={10}
            onChange={e => setTargetScore(Number(e.target.value))}
            className="input w-24"
            placeholder="Custom"
          />
        </div>
      </div>

      {/* Players */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-brand-700 font-semibold">
            <Users size={18} />
            <span>Players ({players.length})</span>
          </div>
          {groupState?.groupName && (
            <span className="badge badge-blue text-xs gap-1">
              <Users size={10} /> {groupState.groupName}
            </span>
          )}
        </div>
        <ul className="space-y-2">
          {players.map(p => (
            <li key={p.uid} className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-base">{p.uid === currentUser?.uid ? '🧑‍💻' : '👤'}</span>
                <span className="font-medium text-sm">{p.displayName}</span>
                {p.uid === currentUser?.uid && <span className="badge badge-blue">you</span>}
                {!p.isGuest && p.uid !== currentUser?.uid && <span className="badge badge-green text-xs">verified</span>}
                {p.isGuest && p.uid !== currentUser?.uid && <span className="badge badge-amber">guest</span>}
              </div>
              {p.uid !== currentUser?.uid && (
                <button onClick={() => removePlayer(p.uid)} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                  <Trash2 size={15} />
                </button>
              )}
            </li>
          ))}
        </ul>
        {/* Add player input with live search */}
        <div className="space-y-1">
          <div className="flex gap-2 relative">
            <div className="relative flex-1">
              {!currentUser?.isGuest && (
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              )}
              <input
                type="text"
                value={playerName}
                onChange={e => { setPlayerName(e.target.value); setError('') }}
                onKeyDown={e => {
                  if (e.key === 'Enter') { setShowSuggestions(false); addPlayer() }
                  if (e.key === 'Escape') setShowSuggestions(false)
                }}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                onFocus={() => searchResults.length > 0 && setShowSuggestions(true)}
                placeholder={currentUser?.isGuest ? 'Add player name…' : 'Add player (type to search verified users)…'}
                className={`input w-full ${!currentUser?.isGuest ? 'pl-8' : ''}`}
                maxLength={30}
              />
              {searching && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin rounded-full h-3 w-3 border-b-2 border-brand-400 block" />
              )}
            </div>
            <button onClick={addPlayer} className="btn-primary px-3 flex-shrink-0" disabled={!playerName.trim()}>
              <Plus size={18} />
            </button>
          </div>

          {/* Search suggestions dropdown */}
          {showSuggestions && searchResults.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
              {searchResults.map(u => (
                <button
                  key={u.uid}
                  onMouseDown={e => e.preventDefault()} // prevent blur before click
                  onClick={() => addVerifiedPlayer(u)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-brand-50 active:bg-brand-100 transition-colors text-left border-b border-gray-50 last:border-0"
                >
                  <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0 text-xs font-bold text-brand-700">
                    {u.displayName.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{u.displayName}</p>
                    {u.email && <p className="text-xs text-gray-400 truncate">{u.email}</p>}
                  </div>
                  <span className="badge badge-green text-xs flex-shrink-0">verified</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-2.5">{error}</p>
      )}

      <button onClick={handleStart} disabled={loading || players.length < 2} className="btn-primary w-full py-3 text-base">
        {loading
          ? <span className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
          : <><LogIn size={18} />Start Game</>
        }
      </button>

      {/* Scoring reference */}
      <div className="card">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Card Values</h3>
        <div className="grid grid-cols-3 gap-2 text-sm">
          {[
            { label: 'Joker', pts: 25 },
            { label: 'Ace (A)', pts: 11 },
            { label: 'J, Q, K', pts: 10 },
            { label: '10', pts: 10 },
            { label: '2 – 9', pts: 'face' },
          ].map(({ label, pts }) => (
            <div key={label} className="bg-gray-50 rounded-xl px-3 py-2 text-center">
              <div className="font-bold text-brand-700">{pts}</div>
              <div className="text-xs text-gray-500">{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Active game gate modal ──────────────────────────────────────────── */}
      {showActiveModal && activeGame && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={20} className="text-amber-600" />
              </div>
              <div>
                <h3 className="font-bold text-base text-gray-900">You have an active game</h3>
                <p className="text-sm text-gray-500 mt-1">
                  You can only play one game at a time. Resume your current game or abandon it to start a new one.
                </p>
              </div>
            </div>

            <div className="bg-gray-50 rounded-xl p-3 text-sm space-y-1">
              <p className="text-gray-500 text-xs uppercase font-semibold tracking-wide">Current game</p>
              <p className="font-medium text-gray-800">
                {activeGame.players.map(p => p.displayName).join(' · ')}
              </p>
              <p className="text-xs text-gray-400">
                Target: {activeGame.targetScore} pts · Round {Object.keys(activeGame.totalScores).length > 0 ? '?' : '0'}
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <button onClick={handleResume} className="btn-primary w-full py-3 justify-between">
                <span>Resume game</span>
                <ArrowRight size={16} />
              </button>
              <button
                onClick={handleAbandon}
                disabled={abandoning}
                className="btn-danger w-full py-2.5"
              >
                {abandoning
                  ? <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  : 'Abandon & start new'
                }
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
