import { useState, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { getPlayerStats, getGamesForPlayer, getUserProfiles } from '../firebase/db'
import type { PlayerStats } from '../firebase/db'
import type { Game } from '../types'
import { Trophy, Target, BarChart2, ChevronRight, ArrowLeft, Users } from 'lucide-react'

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function Ratio({ value, label }: { value: number; label: string }) {
  const pct = Math.round(value * 100)
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-14 h-14">
        <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="#e5e7eb" strokeWidth="3" />
          <circle
            cx="18" cy="18" r="15.9" fill="none"
            stroke={pct >= 50 ? '#16a34a' : '#dc2626'}
            strokeWidth="3"
            strokeDasharray={`${pct} ${100 - pct}`}
            strokeDashoffset="0"
            strokeLinecap="round"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-gray-800">{pct}%</span>
      </div>
      <p className="text-xs text-gray-500 text-center leading-tight">{label}</p>
    </div>
  )
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-gray-50 rounded-2xl px-4 py-3 text-center">
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-xs font-medium text-gray-500 mt-0.5">{label}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

export default function PlayerProfilePage() {
  const { uid } = useParams<{ uid: string }>()
  const { currentUser } = useAuth()
  const navigate = useNavigate()
  const isOwnProfile = uid === currentUser?.uid

  const [stats, setStats]   = useState<PlayerStats | null>(null)
  const [games, setGames]   = useState<Game[]>([])
  const [profile, setProfile] = useState<{ displayName: string; email: string | null; photoURL: string | null } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!uid) return
    setLoading(true)
    Promise.all([
      getPlayerStats(uid),
      isOwnProfile ? getGamesForPlayer(uid, 50) : Promise.resolve([]),
      getUserProfiles([uid]),
    ]).then(([s, g, profiles]) => {
      setStats(s)
      setGames(g)
      setProfile(profiles[uid] ?? null)
    }).finally(() => setLoading(false))
  }, [uid, isOwnProfile])

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-600" />
      </div>
    )
  }

  const displayName = isOwnProfile
    ? (currentUser?.displayName ?? 'You')
    : (profile?.displayName ?? uid ?? 'Player')

  return (
    <div className="space-y-5 pb-6">

      {/* Back + header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-2 rounded-xl hover:bg-gray-100 active:bg-gray-200 transition-colors flex-shrink-0">
          <ArrowLeft size={20} className="text-gray-600" />
        </button>
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-11 h-11 rounded-full bg-brand-100 flex items-center justify-center text-base font-bold text-brand-700 flex-shrink-0">
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-gray-900 truncate">{displayName}</h1>
            {isOwnProfile && <p className="text-xs text-brand-600 font-medium">Your profile</p>}
          </div>
        </div>
      </div>

      {/* ── KPI stats — visible to everyone ── */}
      {stats && stats.gamesPlayed === 0 ? (
        <div className="card text-center py-10">
          <BarChart2 size={36} className="mx-auto mb-3 text-gray-300" />
          <p className="font-medium text-gray-600">No finished games yet</p>
          <p className="text-sm text-gray-400 mt-1">Stats appear after the first completed game.</p>
        </div>
      ) : stats ? (
        <>
          {/* Games KPIs */}
          <div className="card space-y-4">
            <div className="flex items-center gap-2 text-brand-700 font-semibold text-sm">
              <Trophy size={16} />
              <span>Games</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="Played" value={stats.gamesPlayed} />
              <StatCard label="Wins" value={stats.gameWins} />
              <StatCard label="Losses" value={stats.gameLosses} />
            </div>
            <div className="flex justify-center">
              <Ratio value={stats.gameWinRatio} label="Game win rate" />
            </div>
          </div>

          {/* Rounds KPIs */}
          <div className="card space-y-4">
            <div className="flex items-center gap-2 text-brand-700 font-semibold text-sm">
              <Target size={16} />
              <span>Rounds</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="Played" value={stats.roundsPlayed} />
              <StatCard label="Wins" value={stats.roundWins} />
              <StatCard label="Losses" value={stats.roundLosses} />
            </div>
            <div className="flex justify-center">
              <Ratio value={stats.roundWinRatio} label="Round win rate" />
            </div>
          </div>
        </>
      ) : null}

      {/* ── Full game history — own profile only ── */}
      {isOwnProfile && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">My game history</h2>
            <span className="text-xs text-gray-400">({games.length})</span>
          </div>

          {games.length === 0 ? (
            <div className="card text-center py-8 text-gray-400 text-sm">No finished games yet.</div>
          ) : (
            <ul className="space-y-2">
              {games.map(game => {
                const winnerPlayer = game.winner ? game.players.find(p => p.uid === game.winner) : null
                const myScore = game.totalScores[uid ?? ''] ?? 0
                const sortedPlayers = [...game.players].sort(
                  (a, b) => (game.totalScores[a.uid] ?? 0) - (game.totalScores[b.uid] ?? 0)
                )
                const myRank = sortedPlayers.findIndex(p => p.uid === uid) + 1
                const medals = ['🥇', '🥈', '🥉']
                const rankLabel = medals[myRank - 1] ?? `#${myRank}`
                return (
                  <li key={game.id}>
                    <Link to={`/game/${game.id}`} className="card flex items-center gap-3 hover:border-brand-200 transition-colors">
                      <div className="text-2xl flex-shrink-0 w-8 text-center">{rankLabel}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-400">{formatDate(game.createdAt)}</p>
                        <p className="text-sm font-medium text-gray-800 truncate mt-0.5">
                          {winnerPlayer?.uid === uid ? '🏆 Won' : `Lost · ${winnerPlayer?.displayName ?? '?'} won`}
                        </p>
                        <div className="flex items-center gap-1 mt-0.5">
                          <Users size={11} className="text-gray-400" />
                          <p className="text-xs text-gray-400 truncate">
                            {game.players.map(p => p.displayName).join(', ')}
                          </p>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-base font-bold text-gray-800">{myScore}</p>
                        <p className="text-xs text-gray-400">pts</p>
                      </div>
                      <ChevronRight size={15} className="text-gray-400 flex-shrink-0" />
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {/* Notice for other players' profiles */}
      {!isOwnProfile && (
        <p className="text-xs text-gray-400 text-center">
          Full game history is private — only {displayName} can see their own games.
        </p>
      )}
    </div>
  )
}
