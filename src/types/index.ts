// Card types and scoring
export type CardRank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'Joker'
export type CardSuit = 'hearts' | 'diamonds' | 'clubs' | 'spades' | 'none'

export interface Card {
  rank: CardRank
  suit: CardSuit
}

// User
export interface AppUser {
  uid: string
  displayName: string
  email: string | null
  isGuest: boolean
  photoURL?: string | null
}

// Player in a game session
export interface Player {
  uid: string
  displayName: string
  isGuest: boolean
}

// A single round's scores
export interface Round {
  id: string
  roundNumber: number
  scores: Record<string, number>   // uid -> points this round
  createdAt: number
}

// A game session
export interface Game {
  id: string
  targetScore: number
  status: 'active' | 'finished' | 'abandoned'
  players: Player[]
  totalScores: Record<string, number>  // uid -> cumulative points
  winner: string | null                // uid of winner
  createdAt: number
  finishedAt: number | null
  createdBy: string                    // uid
}

// History entry (denormalized for list views)
export interface GameSummary {
  id: string
  targetScore: number
  playerNames: string[]
  winnerName: string | null
  createdAt: number
  finishedAt: number | null
}
