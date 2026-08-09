import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getGame, getRounds, addRound, finishGameManually, updateRound } from '../firebase/db'
import type { Game, Round } from '../types'
import type { CardRank } from '../types'
import ScoreTable from '../components/ScoreTable'
import CardPicker from '../components/CardPicker'
import { useAuth } from '../contexts/AuthContext'
import { Trophy, Plus, Flag, UserCheck } from 'lucide-react'

type PickerState = {
  playerIndex: number   // index into activePlayers array
  scores: Record<string, number>
}

type PostRoundState = 'idle' | 'asking' | 'finishing'

export default function GamePage() {
  const { gameId } = useParams<{ gameId: string }>()
  const navigate = useNavigate()
  const { currentUser, upgradeGuestToGoogle } = useAuth()

  const [game, setGame]         = useState<Game | null>(null)
  const [rounds, setRounds]     = useState<Round[]>([])
  const [loading, setLoading]   = useState(true)
  const [pickerState, setPickerState]   = useState<PickerState | null>(null)
  const [addingRound, setAddingRound]   = useState(false)
  const [submitting, setSubmitting]     = useState(false)
  const [showFinishConfirm, setShowFinishConfirm] = useState(false)
  const [postRound, setPostRound]       = useState<PostRoundState>('idle')
  const [endingGame, setEndingGame]     = useState(false)
  const [newlyEliminated, setNewlyEliminated] = useState<string[]>([])
  const [upgradingGuest, setUpgradingGuest]   = useState(false)
  const [upgradeError, setUpgradeError]       = useState('')

  const load = useCallback(async () => {
    if (!gameId) return
    const [g, rs] = await Promise.all([getGame(gameId), getRounds(gameId)])
    setGame(g)
    setRounds(rs)
    setLoading(false)
  }, [gameId])

  useEffect(() => { load() }, [load])

  // Active (non-eliminated) players only
  const activePlayers = (game?.players ?? []).filter(
    p => !(game?.eliminatedPlayers ?? []).includes(p.uid)
  )

  // ── Start new round ─────────────────────────────────────────────────────────

  const startNewRound = () => {
    if (!game || activePlayers.length === 0) return
    setPickerState({ playerIndex: 0, scores: {} })
    setAddingRound(true)
  }

  const handleCardConfirm = (score: number, _cards: { rank: CardRank; count: number }[]) => {
    if (!game || !pickerState) return
    const player = activePlayers[pickerState.playerIndex]
    const newScores = { ...pickerState.scores, [player.uid]: score }
    const nextIndex = pickerState.playerIndex + 1

    if (nextIndex < activePlayers.length) {
      setPickerState({ playerIndex: nextIndex, scores: newScores })
    } else {
      submitRound(newScores)
    }
  }

  const handlePickerCancel = () => {
    setPickerState(null)
    setAddingRound(false)
  }

  const submitRound = async (scores: Record<string, number>) => {
    if (!gameId || !game) return
    setSubmitting(true)
    const prevEliminated = game.eliminatedPlayers ?? []
    try {
      await addRound(gameId, scores, rounds.length + 1)
      const updated = await getGame(gameId)
      const rs = await getRounds(gameId)
      setGame(updated)
      setRounds(rs)

      if (!updated) return

      // Detect who was newly eliminated this round
      const justEliminated = (updated.eliminatedPlayers ?? []).filter(
        uid => !prevEliminated.includes(uid)
      )
      setNewlyEliminated(justEliminated)

      if (updated.status === 'finished') {
        // Game auto-ended — just show the result
        setPostRound('idle')
      } else {
        // Ask: continue or end?
        setPostRound('asking')
      }
    } catch (e) {
      console.error(e)
    } finally {
      setSubmitting(false)
      setPickerState(null)
      setAddingRound(false)
    }
  }

  const handlePostRoundContinue = () => {
    setPostRound('idle')
    setNewlyEliminated([])
  }

  const handlePostRoundEnd = async () => {
    setEndingGame(true)
    if (!gameId) return
    await finishGameManually(gameId)
    await load()
    setPostRound('idle')
    setEndingGame(false)
    setNewlyEliminated([])
  }

  const handleEditRound = useCallback(async (round: Round, newScores: Record<string, number>) => {
    if (!gameId) return
    await updateRound(gameId, round.id, newScores)
    await load()
  }, [gameId, load])

  const handleFinish = async () => {
    if (!gameId) return
    await finishGameManually(gameId)
    await load()
    setShowFinishConfirm(false)
  }

  // ── Guest upgrade ────────────────────────────────────────────────────────────

  const handleUpgradeGuest = async () => {
    setUpgradingGuest(true)
    setUpgradeError('')
    try {
      await upgradeGuestToGoogle()
    } catch (e: unknown) {
      setUpgradeError('Could not link Google account. Try again.')
      console.error(e)
    } finally {
      setUpgradingGuest(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-600" />
      </div>
    )
  }

  if (!game) {
    return (
      <div className="text-center py-20 text-gray-500">
        Game not found.
        <button onClick={() => navigate('/')} className="btn-ghost block mx-auto mt-4">Go home</button>
      </div>
    )
  }

  const winnerPlayer = game.winner ? game.players.find(p => p.uid === game.winner) : null
  const eliminated   = game.eliminatedPlayers ?? []

  return (
    <div className="space-y-4 pb-6">

      {/* Game header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            {game.status === 'finished' ? '🏁 Game Over' : '🃏 Live Game'}
          </h1>
          <p className="text-sm text-gray-500">
            Target: <strong>{game.targetScore} pts</strong>
            {' · '}{activePlayers.length} active
            {eliminated.length > 0 && ` · ${eliminated.length} eliminated`}
            {' · '}Round {rounds.length}
          </p>
        </div>
        {game.status === 'active'   && <span className="badge badge-green">Active</span>}
        {game.status === 'finished' && <span className="badge badge-amber">Finished</span>}
      </div>

      {/* Guest upgrade banner */}
      {currentUser?.isGuest && game.status === 'active' && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
          <div className="text-sm text-blue-800">
            <p className="font-semibold">Save your game history</p>
            <p className="text-xs text-blue-600 mt-0.5">Sign in with Google to keep records permanently.</p>
          </div>
          <button
            onClick={handleUpgradeGuest}
            disabled={upgradingGuest}
            className="btn-primary text-xs px-3 py-2 gap-1.5 flex-shrink-0"
          >
            {upgradingGuest
              ? <span className="animate-spin rounded-full h-3 w-3 border-b-2 border-white" />
              : <><UserCheck size={13} /> Sign in</>
            }
          </button>
        </div>
      )}
      {upgradeError && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-2">{upgradeError}</p>
      )}

      {/* Winner banner */}
      {game.status === 'finished' && winnerPlayer && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-3">
          <Trophy size={24} className="text-amber-500 flex-shrink-0" />
          <div>
            <p className="font-bold text-amber-900">🏆 Winner: {winnerPlayer.displayName}</p>
            <p className="text-sm text-amber-700">Lowest score: {game.totalScores[winnerPlayer.uid]} pts</p>
          </div>
        </div>
      )}

      {/* Eliminated players notice */}
      {eliminated.length > 0 && game.status === 'active' && (
        <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-2.5">
          <p className="text-sm font-semibold text-red-700 mb-1">Eliminated (exceeded {game.targetScore} pts)</p>
          <div className="flex flex-wrap gap-1.5">
            {eliminated.map(uid => {
              const p = game.players.find(pl => pl.uid === uid)
              return (
                <span key={uid} className="badge bg-red-100 text-red-700">
                  {p?.displayName ?? uid} · {game.totalScores[uid]} pts
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* Score table */}
      <div className="card !p-0 overflow-hidden">
        <ScoreTable
          players={game.players}
          rounds={rounds}
          totalScores={game.totalScores}
          targetScore={game.targetScore}
          status={game.status}
          winner={game.winner}
          eliminatedPlayers={eliminated}
          onEditRound={handleEditRound}
        />
      </div>

      {/* Actions */}
      {game.status === 'active' && (
        <div className="flex gap-3">
          <button
            onClick={startNewRound}
            disabled={addingRound || submitting || activePlayers.length === 0}
            className="btn-primary flex-1 py-3"
          >
            {submitting
              ? <span className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
              : <><Plus size={18} /> Add Round {rounds.length + 1}</>
            }
          </button>
          <button onClick={() => setShowFinishConfirm(true)} className="btn-secondary py-3 px-4" title="End game early">
            <Flag size={18} />
          </button>
        </div>
      )}

      {game.status === 'finished' && (
        <button onClick={() => navigate('/new-game')} className="btn-primary w-full py-3">
          Start New Game
        </button>
      )}

      {/* ── Post-round dialog ── */}
      {postRound === 'asking' && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
            <div className="bg-brand-950 text-white px-5 py-4">
              <h3 className="font-bold text-base">Round {rounds.length} done!</h3>
              <p className="text-xs text-brand-300 mt-0.5">What would you like to do next?</p>
            </div>

            {/* Newly eliminated notice */}
            {newlyEliminated.length > 0 && (
              <div className="bg-red-50 border-b border-red-200 px-5 py-3">
                <p className="text-sm font-semibold text-red-700">
                  {newlyEliminated.length === 1 ? 'Player eliminated:' : 'Players eliminated:'}
                </p>
                {newlyEliminated.map(uid => {
                  const p = game.players.find(pl => pl.uid === uid)
                  return (
                    <p key={uid} className="text-sm text-red-600 mt-0.5">
                      ❌ {p?.displayName} reached {game.totalScores[uid]} pts (target: {game.targetScore})
                    </p>
                  )
                })}
                {activePlayers.length > 0 && (
                  <p className="text-xs text-red-500 mt-1">
                    {activePlayers.length} player{activePlayers.length > 1 ? 's' : ''} still active.
                  </p>
                )}
              </div>
            )}

            <div className="px-5 py-4 space-y-2">
              <button
                onClick={handlePostRoundContinue}
                className="btn-primary w-full py-3 gap-2"
              >
                <Plus size={16} /> Continue — play Round {rounds.length + 1}
              </button>
              <button
                onClick={handlePostRoundEnd}
                disabled={endingGame}
                className="btn-secondary w-full py-2.5 gap-2"
              >
                {endingGame
                  ? <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-500" />
                  : <><Flag size={15} /> End game now</>
                }
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm manual finish */}
      {showFinishConfirm && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm space-y-4 shadow-xl">
            <h3 className="font-bold text-lg">End this game?</h3>
            <p className="text-sm text-gray-600">
              The active player with the lowest score will be declared the winner.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setShowFinishConfirm(false)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={handleFinish} className="btn-primary flex-1">End Game</button>
            </div>
          </div>
        </div>
      )}

      {/* Card picker — key forces full remount per player */}
      {addingRound && pickerState && (
        <CardPicker
          key={`${pickerState.playerIndex}-${activePlayers[pickerState.playerIndex]?.uid}`}
          playerName={activePlayers[pickerState.playerIndex]?.displayName ?? ''}
          onConfirm={handleCardConfirm}
          onCancel={handlePickerCancel}
        />
      )}
    </div>
  )
}
