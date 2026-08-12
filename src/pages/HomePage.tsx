import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { getRecentGames, getPendingInvites } from '../firebase/db'
import type { Game } from '../types'
import { PlusCircle, Trophy, ChevronRight, Users } from 'lucide-react'

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric'
  })
}

export default function HomePage() {
  const { currentUser } = useAuth()
  const [recentGames, setRecentGames] = useState<Game[]>([])
  const [loading, setLoading] = useState(true)
  const [pendingInviteCount, setPendingInviteCount] = useState(0)

  useEffect(() => {
    getRecentGames(5)
      .then(setRecentGames)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!currentUser || currentUser.isGuest) return
    getPendingInvites().then(invites => setPendingInviteCount(invites.length))
  }, [currentUser])

  const activeGames = recentGames.filter(g => g.status === 'active')
  const finishedGames = recentGames.filter(g => g.status === 'finished')

  return (
    <div className="space-y-6 pb-6">
      {/* Welcome */}
      <div className="bg-gradient-to-br from-brand-950 to-brand-700 rounded-2xl p-5 text-white">
        <p className="text-brand-200 text-sm">Welcome back,</p>
        <h1 className="text-2xl font-bold mt-0.5">{currentUser?.displayName}</h1>
        <p className="text-brand-300 text-sm mt-1">
          {currentUser?.isGuest
            ? 'Playing as guest · Sign in with Google to save history'
            : 'Your games are saved to the cloud ☁️'
          }
        </p>
        <div className="flex gap-2 mt-4 flex-wrap">
          <Link to="/new-game" className="inline-flex items-center gap-2 bg-white/15 hover:bg-white/25 active:bg-white/30 transition-colors rounded-xl px-4 py-2.5 text-sm font-medium">
            <PlusCircle size={16} />
            Start New Game
          </Link>
          {!currentUser?.isGuest && (
            <Link to="/groups" className="relative inline-flex items-center gap-2 bg-white/15 hover:bg-white/25 active:bg-white/30 transition-colors rounded-xl px-4 py-2.5 text-sm font-medium">
              <Users size={16} />
              Groups
              {pendingInviteCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                  {pendingInviteCount}
                </span>
              )}
            </Link>
          )}
        </div>
      </div>

      {/* Active games */}
      {activeGames.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Active Games
          </h2>
          <ul className="space-y-2">
            {activeGames.map(game => (
              <li key={game.id}>
                <Link to={`/game/${game.id}`} className="card flex items-center gap-3 hover:border-brand-200 transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">
                      {game.players.map(p => p.displayName).join(' vs ')}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {formatDate(game.createdAt)} · Target {game.targetScore} pts
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="badge badge-green text-xs">Live</span>
                  </div>
                  <ChevronRight size={16} className="text-gray-400 flex-shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Recent finished */}
      {finishedGames.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
              Recent Results
            </h2>
            <Link to="/history" className="text-xs text-brand-600 hover:underline">See all</Link>
          </div>
          <ul className="space-y-2">
            {finishedGames.map(game => {
              const winner = game.winner
                ? game.players.find(p => p.uid === game.winner)
                : null
              return (
                <li key={game.id}>
                  <Link to={`/game/${game.id}`} className="card flex items-center gap-3 hover:border-brand-200 transition-colors">
                    <Trophy size={18} className="text-amber-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">
                        {winner ? `${winner.displayName} won` : 'Completed'}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {formatDate(game.createdAt)} · {game.players.length} players
                      </p>
                    </div>
                    <ChevronRight size={16} className="text-gray-400 flex-shrink-0" />
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {/* Empty state */}
      {!loading && recentGames.length === 0 && (
        <div className="card text-center py-12">
          <span className="text-5xl block mb-3">🃏</span>
          <p className="font-semibold text-gray-700">No games yet!</p>
          <p className="text-sm text-gray-400 mt-1">Start your first Counga session below.</p>
          <Link to="/new-game" className="btn-primary mt-4 inline-flex">
            <PlusCircle size={16} />
            New Game
          </Link>
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
        </div>
      )}

      {/* Scoring cheatsheet */}
      <section className="card">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
          🃏 Card Values Cheatsheet
        </h2>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="flex justify-between bg-gray-50 rounded-xl px-3 py-2">
            <span className="font-mono font-bold">Joker</span>
            <span className="font-bold text-brand-700">25 pts</span>
          </div>
          <div className="flex justify-between bg-gray-50 rounded-xl px-3 py-2">
            <span className="font-mono font-bold">A</span>
            <span className="font-bold text-brand-700">11 pts</span>
          </div>
          <div className="flex justify-between bg-gray-50 rounded-xl px-3 py-2">
            <span className="font-mono font-bold">J / Q / K</span>
            <span className="font-bold text-brand-700">10 pts</span>
          </div>
          <div className="flex justify-between bg-gray-50 rounded-xl px-3 py-2">
            <span className="font-mono font-bold">2 – 10</span>
            <span className="font-bold text-brand-700">face value</span>
          </div>
        </div>
      </section>
    </div>
  )
}
