import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { getRecentGames } from '../firebase/db'
import { useAuth } from '../contexts/AuthContext'
import type { Game } from '../types'
import { Clock, Trophy, ChevronRight, Users, UserCheck } from 'lucide-react'

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric'
  })
}

export default function HistoryPage() {
  const { currentUser, upgradeGuestToGoogle } = useAuth()
  const [games, setGames] = useState<Game[]>([])
  const [loading, setLoading] = useState(true)
  const [upgrading, setUpgrading] = useState(false)
  const [upgradeError, setUpgradeError] = useState('')

  useEffect(() => {
    // Only load history for verified Google accounts
    if (currentUser && !currentUser.isGuest) {
      getRecentGames(30)
        .then(setGames)
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [currentUser])

  const handleUpgrade = async () => {
    setUpgrading(true)
    setUpgradeError('')
    try {
      await upgradeGuestToGoogle()
    } catch {
      setUpgradeError('Could not link Google account. Try again.')
    } finally {
      setUpgrading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-600" />
      </div>
    )
  }

  // Guest wall
  if (currentUser?.isGuest) {
    return (
      <div className="space-y-4 pb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">History</h1>
          <p className="text-sm text-gray-500 mt-1">Only available for Google accounts</p>
        </div>
        <div className="card text-center py-10 space-y-4">
          <Clock size={40} className="mx-auto text-gray-300" />
          <div>
            <p className="font-semibold text-gray-700">Sign in with Google to see history</p>
            <p className="text-sm text-gray-400 mt-1">
              Guest sessions are not saved. Link your Google account to keep a permanent record of all your games.
            </p>
          </div>
          {upgradeError && (
            <p className="text-sm text-red-600">{upgradeError}</p>
          )}
          <button onClick={handleUpgrade} disabled={upgrading} className="btn-primary mx-auto gap-2">
            {upgrading
              ? <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
              : <><UserCheck size={16} /> Sign in with Google</>
            }
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">History</h1>
        <p className="text-sm text-gray-500 mt-1">{games.length} game{games.length !== 1 ? 's' : ''} recorded</p>
      </div>

      {games.length === 0 ? (
        <div className="card text-center py-12 text-gray-400">
          <Clock size={36} className="mx-auto mb-3 opacity-40" />
          <p className="font-medium">No games yet</p>
          <p className="text-sm mt-1">Start a game to see history here.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {games.map(game => {
            const winnerPlayer = game.winner
              ? game.players.find(p => p.uid === game.winner)
              : null

            // Sort by lowest score
            const sortedPlayers = [...game.players].sort(
              (a, b) => (game.totalScores[a.uid] ?? 0) - (game.totalScores[b.uid] ?? 0)
            )

            return (
              <li key={game.id}>
                <Link
                  to={`/game/${game.id}`}
                  className="card flex items-start gap-3 hover:border-brand-200 transition-colors block"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className={`badge ${
                          game.status === 'finished' ? 'badge-green' : 'badge-amber'
                        }`}>
                          {game.status === 'finished' ? 'Finished' : 'Active'}
                        </span>
                        <span className="text-xs text-gray-400">{formatDate(game.createdAt)}</span>
                      </div>
                      <ChevronRight size={16} className="text-gray-400 flex-shrink-0" />
                    </div>

                    {winnerPlayer && (
                      <div className="flex items-center gap-1.5 mb-2">
                        <Trophy size={14} className="text-amber-500" />
                        <span className="text-sm font-semibold text-amber-700">
                          {winnerPlayer.displayName} won
                        </span>
                        <span className="text-xs text-gray-400">
                          ({game.totalScores[winnerPlayer.uid]} pts)
                        </span>
                      </div>
                    )}

                    <div className="flex items-center gap-1.5 mb-2">
                      <Users size={13} className="text-gray-400" />
                      <span className="text-xs text-gray-500">
                        {game.players.map(p => p.displayName).join(', ')}
                      </span>
                    </div>

                    {/* Mini score row */}
                    <div className="flex gap-2 flex-wrap">
                      {sortedPlayers.slice(0, 4).map((p, i) => (
                        <div key={p.uid} className="flex items-center gap-1 text-xs bg-gray-50 rounded-lg px-2 py-1">
                          <span>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`}</span>
                          <span className="font-medium">{p.displayName}</span>
                          <span className="text-gray-400">{game.totalScores[p.uid] ?? 0}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
