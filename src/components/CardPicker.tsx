import { useState } from 'react'
import { ALL_RANKS, CARD_POINTS, calculateHandScore } from '../utils/scoring'
import type { CardRank } from '../types'
import { Minus, Plus, Check } from 'lucide-react'

interface CardPickerProps {
  playerName: string
  onConfirm: (score: number, cards: { rank: CardRank; count: number }[]) => void
  onCancel: () => void
}

export default function CardPicker({ playerName, onConfirm, onCancel }: CardPickerProps) {
  const [counts, setCounts] = useState<Record<CardRank, number>>(() => {
    const init = {} as Record<CardRank, number>
    ALL_RANKS.forEach(r => { init[r] = 0 })
    return init
  })

  const total = calculateHandScore(
    ALL_RANKS.map(r => ({ rank: r, count: counts[r] }))
  )

  const adjust = (rank: CardRank, delta: number) => {
    setCounts(prev => ({
      ...prev,
      [rank]: Math.max(0, prev[rank] + delta)
    }))
  }

  const handleConfirm = () => {
    const cards = ALL_RANKS
      .filter(r => counts[r] > 0)
      .map(r => ({ rank: r, count: counts[r] }))
    onConfirm(total, cards)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100">
          <div>
            <h3 className="font-bold text-base text-gray-900">Enter remaining cards</h3>
            <p className="text-sm text-gray-500 mt-0.5">{playerName}</p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-brand-700">{total}</div>
            <div className="text-xs text-gray-400">points</div>
          </div>
        </div>

        {/* Card list */}
        <div className="overflow-y-auto flex-1 px-5 py-3 space-y-1">
          {ALL_RANKS.map(rank => (
            <div key={rank} className="flex items-center justify-between py-1.5">
              <div className="flex items-center gap-3">
                <span className="w-10 text-center font-mono font-bold text-gray-800 text-base">
                  {rank}
                </span>
                <span className="text-sm text-gray-400">
                  {CARD_POINTS[rank]} pt{CARD_POINTS[rank] > 1 ? 's' : ''} each
                </span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => adjust(rank, -1)}
                  disabled={counts[rank] === 0}
                  className="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center disabled:opacity-30 hover:bg-gray-50 active:bg-gray-100 transition-colors"
                >
                  <Minus size={14} />
                </button>
                <span className="w-6 text-center font-semibold text-gray-900">
                  {counts[rank]}
                </span>
                <button
                  onClick={() => adjust(rank, 1)}
                  className="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center hover:bg-gray-50 active:bg-gray-100 transition-colors"
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 flex gap-3 safe-bottom">
          <button onClick={onCancel} className="btn-secondary flex-1">Cancel</button>
          <button onClick={handleConfirm} className="btn-primary flex-1 gap-2">
            <Check size={16} />
            Confirm {total} pts
          </button>
        </div>
      </div>
    </div>
  )
}
