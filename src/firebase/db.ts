import {
  db,
  auth,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  Timestamp,
} from './config'
import type { Game, Round, Player, AppUser } from '../types'

// ── User helpers ───────────────────────────────────────────────────────────────

export async function upsertUser(user: AppUser): Promise<void> {
  const ref = doc(db, 'users', user.uid)
  await setDoc(ref, {
    displayName: user.displayName,
    email: user.email,
    isGuest: user.isGuest,
    photoURL: user.photoURL ?? null,
    updatedAt: Timestamp.now(),
  }, { merge: true })
}

// ── Game helpers ───────────────────────────────────────────────────────────────

export async function createGame(
  targetScore: number,
  players: Player[],
): Promise<string> {
  const uid = auth.currentUser?.uid ?? 'guest'
  const ref  = doc(collection(db, 'games'))
  const totalScores: Record<string, number> = {}
  players.forEach(p => { totalScores[p.uid] = 0 })

  const game: Omit<Game, 'id'> = {
    targetScore,
    status: 'active',
    players,
    totalScores,
    winner: null,
    createdAt: Date.now(),
    finishedAt: null,
    createdBy: uid,
  }

  await setDoc(ref, game)
  return ref.id
}

export async function getGame(gameId: string): Promise<Game | null> {
  const snap = await getDoc(doc(db, 'games', gameId))
  if (!snap.exists()) return null
  return { id: snap.id, ...snap.data() } as Game
}

export async function addRound(
  gameId: string,
  scores: Record<string, number>,
  roundNumber: number,
): Promise<void> {
  const roundRef = doc(collection(db, 'games', gameId, 'rounds'))
  const round: Omit<Round, 'id'> = {
    roundNumber,
    scores,
    createdAt: Date.now(),
  }
  await setDoc(roundRef, round)

  // Update cumulative totals
  const gameRef = doc(db, 'games', gameId)
  const gameSnap = await getDoc(gameRef)
  if (!gameSnap.exists()) return

  const game = gameSnap.data() as Game
  const newTotals = { ...game.totalScores }
  Object.entries(scores).forEach(([uid, pts]) => {
    newTotals[uid] = (newTotals[uid] ?? 0) + pts
  })

  // Check if any player reached target → finish game
  const hasReachedTarget = Object.values(newTotals).some(s => s >= game.targetScore)
  let winner: string | null = null
  let status: 'active' | 'finished' = 'active'

  if (hasReachedTarget) {
    status = 'finished'
    // Winner is the player with LOWEST total
    winner = Object.entries(newTotals).reduce<string>((best, [uid, pts]) => {
      return pts < (newTotals[best] ?? Infinity) ? uid : best
    }, Object.keys(newTotals)[0])
  }

  await updateDoc(gameRef, {
    totalScores: newTotals,
    status,
    winner,
    finishedAt: status === 'finished' ? Date.now() : null,
  })
}

export async function getRounds(gameId: string): Promise<Round[]> {
  const snap = await getDocs(
    query(collection(db, 'games', gameId, 'rounds'), orderBy('roundNumber'))
  )
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as Round))
}

export async function getRecentGames(count = 20): Promise<Game[]> {
  const snap = await getDocs(
    query(collection(db, 'games'), orderBy('createdAt', 'desc'), limit(count))
  )
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as Game))
}

/** Returns the active game created by the current user, if any */
export async function getActiveGameForUser(uid: string): Promise<Game | null> {
  const snap = await getDocs(
    query(
      collection(db, 'games'),
      where('createdBy', '==', uid),
      where('status', '==', 'active'),
      orderBy('createdAt', 'desc'),
      limit(1),
    )
  )
  if (snap.empty) return null
  const d = snap.docs[0]
  return { id: d.id, ...d.data() } as Game
}

/** Abandons a game without a winner */
export async function abandonGame(gameId: string): Promise<void> {
  await updateDoc(doc(db, 'games', gameId), {
    status: 'abandoned',
    winner: null,
    finishedAt: Date.now(),
  })
}

/** Updates a single round's scores then recomputes all totals from scratch */
export async function updateRound(
  gameId: string,
  roundId: string,
  newScores: Record<string, number>,
): Promise<void> {
  const roundRef = doc(db, 'games', gameId, 'rounds', roundId)
  const gameRef  = doc(db, 'games', gameId)

  // 1. Save the edited round first
  await updateDoc(roundRef, { scores: newScores })

  // 2. Fetch ALL round docs (no orderBy → no index required)
  const [allRoundsSnap, gameSnap] = await Promise.all([
    getDocs(collection(db, 'games', gameId, 'rounds')),
    getDoc(gameRef),
  ])

  if (!gameSnap.exists()) return
  const game = gameSnap.data() as Game

  // 3. Sum every round's scores from scratch
  const newTotals: Record<string, number> = {}
  game.players.forEach(p => { newTotals[p.uid] = 0 })

  allRoundsSnap.docs.forEach(d => {
    // Use the freshly saved scores for the edited round, stored scores for the rest
    const scores = d.id === roundId ? newScores : (d.data().scores ?? {}) as Record<string, number>
    Object.entries(scores).forEach(([uid, pts]) => {
      newTotals[uid] = (newTotals[uid] ?? 0) + pts
    })
  })

  // 4. Persist the recomputed totals
  await updateDoc(gameRef, { totalScores: newTotals })
}

export async function finishGameManually(gameId: string): Promise<void> {
  const gameRef = doc(db, 'games', gameId)
  const gameSnap = await getDoc(gameRef)
  if (!gameSnap.exists()) return

  const game = gameSnap.data() as Game
  const winner = Object.entries(game.totalScores).reduce<string>((best, [uid, pts]) => {
    return pts < (game.totalScores[best] ?? Infinity) ? uid : best
  }, Object.keys(game.totalScores)[0])

  await updateDoc(gameRef, {
    status: 'finished',
    winner,
    finishedAt: Date.now(),
  })
}
