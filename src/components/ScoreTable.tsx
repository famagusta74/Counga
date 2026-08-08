import type { Player, Round } from '../types'
import { rankMedal } from '../utils/scoring'

interface ScoreTableProps {
  players: Player[]
  rounds: Round[]
  totalScores: Record<string, number>
  targetScore: number
  status: 'active' | 'finished'
  winner: string | null
}

export default function ScoreTable({
  players,
  rounds,
  totalScores,
  targetScore,
  status,
  winner,
}: ScoreTableProps) {
  // Sort players by total score ascending (lowest = best)
  const sorted = [...players].sort(
    (a, b) => (totalScores[a.uid] ?? 0) - (totalScores[b.uid] ?? 0)
  )

  if (players.length === 0) return null

  return (
    <div className="overflow-x-auto -mx-4 px-4">
      <table className="w-full text-sm border-collapse min-w-full">
        <thead>
          <tr className="bg-brand-950 text-white">
            <th className="text-left py-2.5 px-3 font-semibold rounded-tl-xl sticky left-0 bg-brand-950 z-10 min-w-[110px]">
              Player
            </th>
            {rounds.map(r => (
              <th key={r.id} className="py-2.5 px-3 font-medium text-brand-200 text-center min-w-[52px]">
                R{r.roundNumber}
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
                    <span className="truncate max-w-[80px]">{player.displayName}</span>
                  </div>
                </td>
                {rounds.map(r => (
                  <td key={r.id} className="py-2.5 px-3 text-center text-gray-600">
                    {r.scores[player.uid] ?? '—'}
                  </td>
                ))}
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
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
