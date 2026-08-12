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

// A player group (created by a verified Google-auth user)
export interface Group {
  id: string
  name: string
  ownerUid: string
  memberUids: string[]        // confirmed member uids (includes owner)
  pendingInviteUids: string[] // uids who have been invited but not yet accepted
  createdAt: number
}

// An invite stored on the invitee's user doc for fast inbox lookup
export interface GroupInvite {
  groupId: string
  groupName: string
  ownerUid: string
  ownerName: string
  invitedAt: number
}

// Lightweight user search result
export interface UserSearchResult {
  uid: string
  displayName: string
  email: string | null
  photoURL: string | null
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
  roundWinnerUid: string | null    // uid of the player who won this round (0 pts)
  createdAt: number
}

// A game session
export interface Game {
  id: string
  targetScore: number
  status: 'active' | 'finished' | 'abandoned'
  players: Player[]
  eliminatedPlayers: string[]          // uids of players who exceeded targetScore
  totalScores: Record<string, number>  // uid -> cumulative points
  winner: string | null                // uid of winner
  roundCount: number                   // total rounds played (incremented on each addRound)
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
