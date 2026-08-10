import { useState } from 'react'
import type { Player, Round } from '../types'
import { rankMedal } from '../utils/scoring'
import { Pencil, Check, X } from 'lucide-react'

interface ScoreTableProps {
  players: Player[]
  rounds: Round[]
  totalScores: Record<string, number>
  targetScore: number
  status: 'active' | 'finished' | 'abandoned'
  winner: string | null
  eliminatedPlayers?: string[]
  onEditRound?: (round: Round, newScores: Record<string, number>) => Promise<void>
}

export default function ScoreTable({
  players,
  rounds,
  totalScores,
  targetScore,
  status,
  winner,
  eliminatedPlayers = [],
  onEditRound,
}: ScoreTableProps) {
  const sorted = [...players].sort(
    (a, b) => (totalScores[a.uid] ?? 0) - (totalScores[b.uid] ?? 0)
  )

  // Edit state
  const [editingRound, setEditingRound] = useState<Round | null>(null)
  const [editScores, setEditScores] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const openEdit = (round: Round) => {
    setEditingRound(round)
    const init: Record<string, string> = {}
    players.forEach(p => { init[p.uid] = String(round.scores[p.uid] ?? 0) })
    setEditScores(init)
  }

  const closeEdit = () => {
    setEditingRound(null)
    setEditScores({})
  }

  const saveEdit = async () => {
    if (!editingRound || !onEditRound) return
    setSaving(true)
    try {
      const newScores: Record<string, number> = {}
      players.forEach(p => {
        newScores[p.uid] = Math.max(0, parseInt(editScores[p.uid] ?? '0', 10) || 0)
      })
      await onEditRound(editingRound, newScores)
      closeEdit()
    } finally {
      setSaving(false)
    }
  }

  if (players.length === 0) return null

  return (
    <>
      <div className="overflow-x-auto -mx-4 px-4">
        <table className="w-full text-sm border-collapse min-w-full">
          <thead>
            <tr className="bg-brand-950 text-white">
              <th className="text-left py-2.5 px-3 font-semibold rounded-tl-xl sticky left-0 bg-brand-950 z-10 min-w-[110px]">
                Player
              </th>
              {rounds.map(r => (
                <th key={r.id} className="py-2.5 px-3 font-medium text-brand-200 text-center min-w-[52px]">
                  <div className="flex items-center justify-center gap-1">
                    <span>R{r.roundNumber}</span>
                    {onEditRound && (
                      <button
                        onClick={() => openEdit(r)}
                        className="opacity-50 hover:opacity-100 active:opacity-100 transition-opacity p-0.5 rounded"
                        title={`Edit round ${r.roundNumber}`}
                      >
                        <Pencil size={11} />
                      </button>
                    )}
                  </div>
                </th>
              ))}
              <th className="py-2.5 px-3 font-semibold text-right rounded-tr-xl min-w-[60px]">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((player, idx) => {
              const total = totalScores[player.uid] ?? 0
              const isOver = total >= targetScore
              const isWinner = winner === player.uid
              return (
                <tr
                  key={player.uid}
                  className={`border-b border-gray-100 transition-colors ${
                    isWinner ? 'bg-amber-50' : idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                  }`}
                >
                  <td className={`py-2.5 px-3 font-medium sticky left-0 z-10 ${
                    isWinner ? 'bg-amber-50' : idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                  }`}>
                    <div className="flex items-center gap-1.5">
                      <span>{rankMedal(idx + 1)}</span>
                      <span className={`truncate max-w-[80px] ${eliminatedPlayers.includes(player.uid) ? 'line-through text-gray-400' : ''}`}>
                        {player.displayName}
                      </span>
                      {eliminatedPlayers.includes(player.uid) && (
                        <span className="text-xs text-red-500 font-normal">out</span>
                      )}
                    </div>
                  </td>
                  {rounds.map(r => {
                    const cellScore = r.scores[player.uid]
                    const isRoundWinner = r.roundWinnerUid === player.uid
                    return (
                      <td
                        key={r.id}
                        className={`py-2.5 px-3 text-center ${isRoundWinner ? 'text-amber-600 font-bold bg-amber-50' : 'text-gray-600'}`}
                      >
                        {isRoundWinner
                          ? <span title="Round winner">⭐ 0</span>
                          : (cellScore ?? '—')
                        }
                      </td>
                    )
                  })}
                  <td className={`py-2.5 px-3 text-right font-bold ${
                    isOver ? 'text-red-600' : 'text-gray-900'
                  }`}>
                    {total}
                    {isWinner && status === 'finished' && (
                      <span className="ml-1">👑</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="bg-gray-50">
              <td colSpan={rounds.length + 2} className="py-2 px-3 text-xs text-gray-400 text-right">
                Target: <span className="font-semibold text-gray-600">{targetScore} pts</span>
                {onEditRound && (
                  <span className="ml-2 opacity-60">· tap <Pencil size={10} className="inline" /> on a round to edit</span>
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ── Edit round modal ── */}
      {editingRound && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="bg-brand-950 text-white px-5 py-4 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-base">Edit Round {editingRound.roundNumber}</h3>
                <p className="text-xs text-brand-300 mt-0.5">Change any player's score for this round</p>
              </div>
              <button onClick={closeEdit} className="p-1.5 rounded-lg hover:bg-brand-800 transition-colors">
                <X size={18} />
              </button>
            </div>

            {/* Score inputs */}
            <div className="px-5 py-4 space-y-3">
              {players.map(p => (
                <div key={p.uid} className="flex items-center justify-between gap-3">
                  <label className="text-sm font-medium text-gray-800 flex-1 truncate">
                    {p.displayName}
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setEditScores(prev => ({
                        ...prev,
                        [p.uid]: String(Math.max(0, (parseInt(prev[p.uid] || '0', 10) || 0) - 1))
                      }))}
                      className="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center hover:bg-gray-50 active:bg-gray-100 transition-colors text-lg leading-none font-bold text-gray-500"
                    >−</button>
                    <input
                      type="number"
                      min={0}
                      value={editScores[p.uid] ?? '0'}
                      onChange={e => setEditScores(prev => ({ ...prev, [p.uid]: e.target.value }))}
                      className="w-16 text-center font-bold text-lg border border-gray-200 rounded-xl py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                    <button
                      onClick={() => setEditScores(prev => ({
                        ...prev,
                        [p.uid]: String((parseInt(prev[p.uid] || '0', 10) || 0) + 1)
                      }))}
                      className="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center hover:bg-gray-50 active:bg-gray-100 transition-colors text-lg leading-none font-bold text-gray-500"
                    >+</button>
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="px-5 pb-5 flex gap-3">
              <button onClick={closeEdit} className="btn-secondary flex-1">Cancel</button>
              <button onClick={saveEdit} disabled={saving} className="btn-primary flex-1 gap-2">
                {saving
                  ? <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  : <><Check size={15} /> Save changes</>
                }
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
