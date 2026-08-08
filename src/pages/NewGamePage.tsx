import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { createGame, getActiveGameForUser, abandonGame } from '../firebase/db'
import type { Player, Game } from '../types'
import { Plus, Trash2, Users, Target, LogIn, AlertTriangle, ArrowRight } from 'lucide-react'

export default function NewGamePage() {
  const { currentUser } = useAuth()
  const navigate = useNavigate()

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
    setError('')
  }

  const removePlayer = (uid: string) => {
    if (uid === currentUser?.uid) return
    setPlayers(prev => prev.filter(p => p.uid !== uid))
  }

  const handleStart = async () => {
    if (players.length < 2) { setError('You need at least 2 players.'); return }
    if (targetScore < 10)   { setError('Target score must be at least 10.'); return }
    setLoading(true)
    try {
      const gameId = await createGame(targetScore, players)
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
        <p className="text-sm text-gray-500 mt-1">Set up a fresh Counga session</p>
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
        <div className="flex items-center gap-2 text-brand-700 font-semibold">
          <Users size={18} />
          <span>Players ({players.length})</span>
        </div>
        <ul className="space-y-2">
          {players.map(p => (
            <li key={p.uid} className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-base">{p.uid === currentUser?.uid ? '🧑‍💻' : '👤'}</span>
                <span className="font-medium text-sm">{p.displayName}</span>
                {p.uid === currentUser?.uid && <span className="badge badge-blue">you</span>}
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
        <div className="flex gap-2">
          <input
            type="text"
            value={playerName}
            onChange={e => setPlayerName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addPlayer()}
            placeholder="Add player name…"
            className="input flex-1"
            maxLength={30}
          />
          <button onClick={addPlayer} className="btn-primary px-3" disabled={!playerName.trim()}>
            <Plus size={18} />
          </button>
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
