import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getGame, getRounds, addRound, finishGameManually, updateRound, addPlayerToGame } from '../firebase/db'
import type { Game, Round } from '../types'
import type { CardRank } from '../types'
import ScoreTable from '../components/ScoreTable'
import CardPicker from '../components/CardPicker'
import { useAuth } from '../contexts/AuthContext'
import { Trophy, Plus, Flag, UserCheck, Star, UserPlus, AlertTriangle } from 'lucide-react'

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

  // Round winner flow
  const [roundWinnerUid, setRoundWinnerUid]         = useState<string | null>(null)
  const [showWinnerPrompt, setShowWinnerPrompt]     = useState(false)
  const [suggestedWinnerUid, setSuggestedWinnerUid] = useState<string | null>(null)
  const [roundError, setRoundError]                 = useState('')
  // Scores from the round that just finished — used in the post-round standings
  const [lastRoundScores, setLastRoundScores]       = useState<Record<string, number>>({})

  // Add player mid-game
  const [showAddPlayer, setShowAddPlayer]   = useState(false)
  const [newPlayerName, setNewPlayerName]   = useState('')
  const [addingPlayer, setAddingPlayer]     = useState(false)
  const [addPlayerError, setAddPlayerError] = useState('')

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

  // ── Start new round ──────────────────────────────────────────────────────────

  const startNewRound = () => {
    if (!game || activePlayers.length === 0) return
    setRoundWinnerUid(null)
    setSuggestedWinnerUid(null)
    setRoundError('')
    setPickerState({ playerIndex: 0, scores: {} })
    setAddingRound(true)
  }

  // After each player's score is confirmed, check if the next player
  // can be auto-suggested as the round winner (all previous scores > 0)
  const handleCardConfirm = (score: number, _cards: { rank: CardRank; count: number }[]) => {
    if (!game || !pickerState) return
    const player = activePlayers[pickerState.playerIndex]
    // If this player was declared round winner, force score to 0
    const effectiveScore = roundWinnerUid === player.uid ? 0 : score
    const newScores = { ...pickerState.scores, [player.uid]: effectiveScore }
    const nextIndex = pickerState.playerIndex + 1

    if (nextIndex < activePlayers.length) {
      // Only suggest the next player as round winner when:
      //   1. they are the LAST player remaining (nextIndex === last index), AND
      //   2. every score collected so far is > 0 (nobody else had 0 cards)
      const isLastPlayer   = nextIndex === activePlayers.length - 1
      const allAboveZero   = Object.values(newScores).every(s => s > 0)
      if (isLastPlayer && allAboveZero && roundWinnerUid === null) {
        setSuggestedWinnerUid(activePlayers[nextIndex].uid)
        setPickerState({ playerIndex: nextIndex, scores: newScores })
        setShowWinnerPrompt(true)
      } else {
        setPickerState({ playerIndex: nextIndex, scores: newScores })
      }
    } else {
      submitRound(newScores)
    }
  }

  // User confirms the suggested player is the round winner → assign 0 pts and close round
  const handleConfirmWinner = () => {
    if (!pickerState || !suggestedWinnerUid) return
    const winnerUid = suggestedWinnerUid
    setRoundWinnerUid(winnerUid)
    setShowWinnerPrompt(false)
    // Set this player's score to 0 and close the round
    const finalScores = { ...pickerState.scores, [winnerUid]: 0 }
    // Fill any remaining unscored players with 0 too (safety)
    activePlayers.forEach(p => {
      if (!(p.uid in finalScores)) finalScores[p.uid] = 0
    })
    submitRound(finalScores, winnerUid)
  }

  // User dismisses the suggestion — open CardPicker for the suggested player normally
  const handleDismissWinnerPrompt = () => {
    setShowWinnerPrompt(false)
    setSuggestedWinnerUid(null)
  }

  // User taps "Won this round" on any CardPicker screen mid-round
  const handlePickerWinner = (playerUid: string) => {
    setRoundWinnerUid(playerUid)
    // Continue collecting remaining players — this player's score will be 0 when round submits
    // We don't close the round here; the caller proceeds to next player normally
    // (GamePage will pass 0 for this player when submitRound is called at the end)
  }

  const handlePickerCancel = () => {
    setPickerState(null)
    setAddingRound(false)
    setShowWinnerPrompt(false)
    setSuggestedWinnerUid(null)
    setRoundWinnerUid(null)
  }

  const submitRound = async (scores: Record<string, number>, winnerUid: string | null = roundWinnerUid) => {
    if (!gameId || !game) return

    // ── Validation: exactly one winner (0 pts) per round ──────────────────────
    const zeroCount = Object.values(scores).filter(s => s === 0).length
    if (zeroCount === 0) {
      setRoundError(
        'Every round must have one winner with 0 points. ' +
        'Use the ⭐ button to mark the winner, or manually enter 0 for them.'
      )
      setPickerState(null); setAddingRound(false)
      setRoundWinnerUid(null); setSuggestedWinnerUid(null)
      return
    }
    if (zeroCount > 1) {
      setRoundError(
        `${zeroCount} players have 0 points this round — only one winner is allowed. ` +
        'Please re-enter the round and correct the scores.'
      )
      setPickerState(null); setAddingRound(false)
      setRoundWinnerUid(null); setSuggestedWinnerUid(null)
      return
    }
    setRoundError('')

    setSubmitting(true)
    const prevEliminated = game.eliminatedPlayers ?? []
    try {
      await addRound(gameId, scores, rounds.length + 1, winnerUid)
      const updated = await getGame(gameId)
      const rs = await getRounds(gameId)
      setGame(updated)
      setRounds(rs)

      if (!updated) return

      const justEliminated = (updated.eliminatedPlayers ?? []).filter(
        uid => !prevEliminated.includes(uid)
      )
      setNewlyEliminated(justEliminated)
      setLastRoundScores(scores)

      if (updated.status === 'finished') {
        setPostRound('idle')
      } else {
        setPostRound('asking')
      }
    } catch (e) {
      console.error(e)
    } finally {
      setSubmitting(false)
      setPickerState(null)
      setAddingRound(false)
      setRoundWinnerUid(null)
      setSuggestedWinnerUid(null)
    }
  }

  const handlePostRoundContinue = () => {
    setPostRound('idle')
    setNewlyEliminated([])
    setLastRoundScores({})
    setShowAddPlayer(false)
    setNewPlayerName('')
    setAddPlayerError('')
  }

  const handleAddPlayer = async () => {
    const name = newPlayerName.trim()
    if (!name) { setAddPlayerError('Enter a name.'); return }
    if (!game || !gameId) return
    if (game.players.some(p => p.displayName.toLowerCase() === name.toLowerCase())) {
      setAddPlayerError('A player with that name is already in the game.')
      return
    }
    setAddingPlayer(true)
    setAddPlayerError('')
    try {
      // Starting score = highest current total among all players
      const highestScore = Math.max(0, ...Object.values(game.totalScores))
      const newPlayer = {
        uid: `guest_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        displayName: name,
        isGuest: true,
      }
      await addPlayerToGame(gameId, newPlayer, highestScore)
      await load()
      setShowAddPlayer(false)
      setNewPlayerName('')
    } catch (e) {
      console.error(e)
      setAddPlayerError('Failed to add player. Try again.')
    } finally {
      setAddingPlayer(false)
    }
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

  // ── Guest upgrade ─────────────────────────────────────────────────────────────

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

  // ── Render ────────────────────────────────────────────────────────────────────

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
  const suggestedWinnerPlayer = suggestedWinnerUid
    ? activePlayers.find(p => p.uid === suggestedWinnerUid)
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

      {/* Game winner banner */}
      {game.status === 'finished' && winnerPlayer && (() => {
        const durationMs = game.finishedAt && game.createdAt ? game.finishedAt - game.createdAt : null
        const durationStr = durationMs
          ? durationMs < 3_600_000
            ? `${Math.round(durationMs / 60_000)} min`
            : `${(durationMs / 3_600_000).toFixed(1)} h`
          : null
        const roundCount = game.roundCount ?? rounds.length
        return (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-3">
              <Trophy size={24} className="text-amber-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-bold text-amber-900 text-lg">🏆 {winnerPlayer.displayName} wins!</p>
                <p className="text-sm text-amber-700">Lowest score: {game.totalScores[winnerPlayer.uid]} pts</p>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <span className="bg-amber-100 text-amber-800 text-xs font-medium px-2.5 py-1 rounded-full">
                {roundCount} round{roundCount !== 1 ? 's' : ''}
              </span>
              {durationStr && (
                <span className="bg-amber-100 text-amber-800 text-xs font-medium px-2.5 py-1 rounded-full">
                  ⏱ {durationStr}
                </span>
              )}
              <span className="bg-amber-100 text-amber-800 text-xs font-medium px-2.5 py-1 rounded-full">
                {game.players.length} players
              </span>
            </div>
            {/* Final standings mini-list */}
            <div className="space-y-1">
              {[...game.players]
                .sort((a, b) => (game.totalScores[a.uid] ?? 0) - (game.totalScores[b.uid] ?? 0))
                .map((p, i) => {
                  const medals = ['🥇', '🥈', '🥉']
                  return (
                    <div key={p.uid} className="flex items-center gap-2 bg-white/60 rounded-xl px-3 py-1.5">
                      <span className="text-base w-6 text-center flex-shrink-0">{medals[i] ?? `#${i + 1}`}</span>
                      <span className="flex-1 text-sm font-medium text-amber-900 truncate">{p.displayName}</span>
                      <span className="text-sm font-bold text-amber-700">{game.totalScores[p.uid] ?? 0} pts</span>
                    </div>
                  )
                })}
            </div>
          </div>
        )
      })()}

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

      {/* Round validation error */}
      {roundError && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-300 rounded-2xl px-4 py-3">
          <AlertTriangle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-700">Round cannot be saved</p>
            <p className="text-sm text-red-600 mt-0.5">{roundError}</p>
            <button
              onClick={() => { setRoundError(''); startNewRound() }}
              className="mt-2 text-xs font-semibold text-red-700 underline active:opacity-70"
            >
              Re-enter this round →
            </button>
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

      {/* ── Round winner suggestion prompt ── */}
      {showWinnerPrompt && suggestedWinnerPlayer && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">

            {/* Header */}
            <div className="bg-brand-950 text-white px-5 py-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-400/20 flex items-center justify-center flex-shrink-0">
                <Star size={20} className="text-amber-300" fill="currentColor" />
              </div>
              <div>
                <h3 className="font-bold text-base">Round winner?</h3>
                <p className="text-xs text-brand-300 mt-0.5">All other players have cards remaining</p>
              </div>
            </div>

            {/* Body */}
            <div className="px-5 py-5 space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-center">
                <p className="text-xs text-amber-600 uppercase font-semibold tracking-wide mb-1">Suggested winner</p>
                <p className="text-2xl font-bold text-amber-900">{suggestedWinnerPlayer.displayName}</p>
                <p className="text-sm text-amber-700 mt-1">Gets <strong>0 points</strong> this round</p>
              </div>

              <button
                onClick={handleConfirmWinner}
                className="btn-primary w-full py-3.5 text-base gap-2"
              >
                <Star size={18} fill="currentColor" />
                Yes — {suggestedWinnerPlayer.displayName} won this round
              </button>

              <button
                onClick={handleDismissWinnerPrompt}
                className="btn-secondary w-full py-2.5"
              >
                No — enter their cards instead
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Post-round dialog ── */}
      {postRound === 'asking' && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">

            {/* Header */}
            <div className="bg-brand-950 text-white px-5 py-4 flex-shrink-0">
              <h3 className="font-bold text-base">Round {rounds.length} complete</h3>
              <p className="text-xs text-brand-300 mt-0.5">Standings after this round</p>
            </div>

            {/* ── Standings ── */}
            <div className="flex-1 overflow-y-auto">
              <div className="divide-y divide-gray-100">
                {[...game.players]
                  .sort((a, b) => (game.totalScores[a.uid] ?? 0) - (game.totalScores[b.uid] ?? 0))
                  .map((p, idx) => {
                    const total     = game.totalScores[p.uid] ?? 0
                    const roundPts  = lastRoundScores[p.uid] ?? null
                    const isWinner  = roundPts === 0
                    const isElim    = (game.eliminatedPlayers ?? []).includes(p.uid)
                    const justElim  = newlyEliminated.includes(p.uid)
                    const medals    = ['🥇','🥈','🥉']
                    const rank      = medals[idx] ?? `${idx + 1}.`
                    return (
                      <div
                        key={p.uid}
                        className={`flex items-center gap-3 px-5 py-3 ${
                          isWinner ? 'bg-amber-50' : justElim ? 'bg-red-50' : ''
                        }`}
                      >
                        {/* Rank */}
                        <span className="text-lg w-7 text-center flex-shrink-0">{rank}</span>

                        {/* Name */}
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-semibold truncate ${isElim ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                            {p.displayName}
                          </p>
                          {justElim && (
                            <p className="text-xs text-red-500 font-medium">Eliminated this round</p>
                          )}
                        </div>

                        {/* This round's score */}
                        {roundPts !== null && (
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${
                            isWinner
                              ? 'bg-amber-200 text-amber-800'
                              : 'bg-gray-100 text-gray-600'
                          }`}>
                            {isWinner ? '⭐ +0' : `+${roundPts}`}
                          </span>
                        )}

                        {/* Cumulative total */}
                        <span className={`text-base font-bold w-14 text-right flex-shrink-0 ${
                          total >= game.targetScore ? 'text-red-500' : 'text-gray-900'
                        }`}>
                          {total}
                        </span>
                      </div>
                    )
                  })}
              </div>

              {/* Eliminated notice if any */}
              {newlyEliminated.length > 0 && (
                <div className="bg-red-50 border-t border-red-100 px-5 py-2.5">
                  <p className="text-xs text-red-600 font-medium">
                    ❌ {newlyEliminated.map(uid => game.players.find(p => p.uid === uid)?.displayName).join(', ')} reached {game.targetScore} pts and {newlyEliminated.length === 1 ? 'is' : 'are'} eliminated.
                  </p>
                </div>
              )}
            </div>

            {/* ── Add player panel (toggled) ── */}
            {showAddPlayer ? (
              <div className="px-5 py-4 space-y-3">
                <p className="text-sm font-semibold text-gray-800">Add a new player</p>
                <p className="text-xs text-gray-500">
                  They will start with <strong>{Math.max(0, ...Object.values(game.totalScores))} pts</strong> — the highest score in the game.
                </p>
                <input
                  type="text"
                  value={newPlayerName}
                  onChange={e => { setNewPlayerName(e.target.value); setAddPlayerError('') }}
                  onKeyDown={e => e.key === 'Enter' && handleAddPlayer()}
                  placeholder="Player name…"
                  className="input"
                  maxLength={30}
                  autoFocus
                />
                {addPlayerError && (
                  <p className="text-xs text-red-600">{addPlayerError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => { setShowAddPlayer(false); setNewPlayerName(''); setAddPlayerError('') }}
                    className="btn-secondary flex-1"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddPlayer}
                    disabled={addingPlayer || !newPlayerName.trim()}
                    className="btn-primary flex-1 gap-2"
                  >
                    {addingPlayer
                      ? <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                      : <><UserPlus size={15} /> Add</>
                    }
                  </button>
                </div>
              </div>
            ) : (
              <div className="px-5 py-4 space-y-2">
                <button
                  onClick={handlePostRoundContinue}
                  className="btn-primary w-full py-3 gap-2"
                >
                  <Plus size={16} /> Continue — play Round {rounds.length + 1}
                </button>
                <button
                  onClick={() => setShowAddPlayer(true)}
                  className="btn-secondary w-full py-2.5 gap-2"
                >
                  <UserPlus size={15} /> Add a player to the game
                </button>
                <button
                  onClick={handlePostRoundEnd}
                  disabled={endingGame}
                  className="btn-ghost w-full py-2 gap-2 text-gray-500"
                >
                  {endingGame
                    ? <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-500" />
                    : <><Flag size={15} /> End game now</>
                  }
                </button>
              </div>
            )}
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

      {/* Card picker — shown only when NOT showing the winner prompt */}
      {addingRound && pickerState && !showWinnerPrompt && (
        <CardPicker
          key={`${pickerState.playerIndex}-${activePlayers[pickerState.playerIndex]?.uid}`}
          playerName={activePlayers[pickerState.playerIndex]?.displayName ?? ''}
          roundWinnerUid={roundWinnerUid}
          onConfirm={handleCardConfirm}
          onWinner={() => handlePickerWinner(activePlayers[pickerState.playerIndex]?.uid ?? '')}
          onCancel={handlePickerCancel}
        />
      )}
    </div>
  )
}
