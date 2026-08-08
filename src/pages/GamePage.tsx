import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getGame, getRounds, addRound, finishGameManually } from '../firebase/db'
import type { Game, Round } from '../types'
import type { CardRank } from '../types'
import ScoreTable from '../components/ScoreTable'
import CardPicker from '../components/CardPicker'
import { Trophy, Plus, ChevronDown, ChevronUp, Flag } from 'lucide-react'

type PickerState = {
  playerIndex: number
  scores: Record<string, number>
}

export default function GamePage() {
  const { gameId } = useParams<{ gameId: string }>()
  const navigate = useNavigate()

  const [game, setGame] = useState<Game | null>(null)
  const [rounds, setRounds] = useState<Round[]>([])
  const [loading, setLoading] = useState(true)
  const [showPicker, setShowPicker] = useState(false)
  const [pickerState, setPickerState] = useState<PickerState | null>(null)
  const [addingRound, setAddingRound] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [showFinishConfirm, setShowFinishConfirm] = useState(false)

  const load = useCallback(async () => {
    if (!gameId) return
    const [g, rs] = await Promise.all([getGame(gameId), getRounds(gameId)])
    setGame(g)
    setRounds(rs)
    setLoading(false)
  }, [gameId])

  useEffect(() => { load() }, [load])

  // ── Start entering a new round ──────────────────────────────────────────────

  const startNewRound = () => {
    if (!game) return
    setPickerState({ playerIndex: 0, scores: {} })
    setAddingRound(true)
  }

  const handleCardConfirm = (score: number, _cards: { rank: CardRank; count: number }[]) => {
    if (!game || !pickerState) return
    const player = game.players[pickerState.playerIndex]
    const newScores = { ...pickerState.scores, [player.uid]: score }
    const nextIndex = pickerState.playerIndex + 1

    if (nextIndex < game.players.length) {
      setPickerState({ playerIndex: nextIndex, scores: newScores })
    } else {
      // All players entered — submit round
      submitRound(newScores)
    }
  }

  const handlePickerCancel = () => {
    setPickerState(null)
    setAddingRound(false)
  }

  const submitRound = async (scores: Record<string, number>) => {
    if (!gameId) return
    setSubmitting(true)
    try {
      await addRound(gameId, scores, rounds.length + 1)
      await load()
    } catch (e) {
      console.error(e)
    } finally {
      setSubmitting(false)
      setPickerState(null)
      setAddingRound(false)
    }
  }

  const handleFinish = async () => {
    if (!gameId) return
    await finishGameManually(gameId)
    await load()
    setShowFinishConfirm(false)
  }

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

  const winnerPlayer = game.winner
    ? game.players.find(p => p.uid === game.winner)
    : null

  return (
    <div className="space-y-4 pb-6">
      {/* Game header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            {game.status === 'finished' ? '🏁 Game Over' : '🃏 Live Game'}
          </h1>
          <p className="text-sm text-gray-500">
            Target: <strong>{game.targetScore} pts</strong> · {game.players.length} players · Round {rounds.length}
          </p>
        </div>
        {game.status === 'active' && (
          <span className="badge badge-green">Active</span>
        )}
        {game.status === 'finished' && (
          <span className="badge badge-amber">Finished</span>
        )}
      </div>

      {/* Winner banner */}
      {game.status === 'finished' && winnerPlayer && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-3">
          <Trophy size={24} className="text-amber-500 flex-shrink-0" />
          <div>
            <p className="font-bold text-amber-900">Winner: {winnerPlayer.displayName}</p>
            <p className="text-sm text-amber-700">
              Lowest score: {game.totalScores[winnerPlayer.uid]} pts
            </p>
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
        />
      </div>

      {/* Actions */}
      {game.status === 'active' && (
        <div className="flex gap-3">
          <button
            onClick={startNewRound}
            disabled={addingRound || submitting}
            className="btn-primary flex-1 py-3"
          >
            {submitting ? (
              <span className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
            ) : (
              <>
                <Plus size={18} />
                Add Round {rounds.length + 1}
              </>
            )}
          </button>
          <button
            onClick={() => setShowFinishConfirm(true)}
            className="btn-secondary py-3 px-4"
            title="Finish game early"
          >
            <Flag size={18} />
          </button>
        </div>
      )}

      {game.status === 'finished' && (
        <button onClick={() => navigate('/new-game')} className="btn-primary w-full py-3">
          Start New Game
        </button>
      )}

      {/* Confirm finish modal */}
      {showFinishConfirm && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm space-y-4 shadow-xl">
            <h3 className="font-bold text-lg">End this game?</h3>
            <p className="text-sm text-gray-600">
              The player with the lowest score will be declared the winner.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setShowFinishConfirm(false)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={handleFinish} className="btn-primary flex-1">End Game</button>
            </div>
          </div>
        </div>
      )}

      {/* Card picker modal */}
      {addingRound && pickerState && (
        <CardPicker
          playerName={game.players[pickerState.playerIndex].displayName}
          onConfirm={handleCardConfirm}
          onCancel={handlePickerCancel}
        />
      )}
    </div>
  )
}
