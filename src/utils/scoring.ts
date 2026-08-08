import type { CardRank } from '../types'

export const CARD_POINTS: Record<CardRank, number> = {
  'A':    11,
  '2':     2,
  '3':     3,
  '4':     4,
  '5':     5,
  '6':     6,
  '7':     7,
  '8':     8,
  '9':     9,
  '10':   10,
  'J':    10,
  'Q':    10,
  'K':    10,
  'Joker': 25,
}

export const ALL_RANKS: CardRank[] = [
  'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'Joker'
]

export function calculateHandScore(cards: { rank: CardRank; count: number }[]): number {
  return cards.reduce((sum, c) => sum + CARD_POINTS[c.rank] * c.count, 0)
}

/** Returns medal emoji for rank position (1-indexed) */
export function rankMedal(position: number): string {
  if (position === 1) return '🥇'
  if (position === 2) return '🥈'
  if (position === 3) return '🥉'
  return `#${position}`
}
