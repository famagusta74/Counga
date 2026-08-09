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
    eliminatedPlayers: [],
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
  const data = snap.data() as Omit<Game, 'id'>
  // Back-compat: old games without eliminatedPlayers
  return { id: snap.id, eliminatedPlayers: [], ...data } as Game
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

  const game = { eliminatedPlayers: [], ...gameSnap.data() } as Game
  const newTotals = { ...game.totalScores }
  Object.entries(scores).forEach(([uid, pts]) => {
    newTotals[uid] = (newTotals[uid] ?? 0) + pts
  })

  // Work out who is newly eliminated (exceeded target this round)
  const newlyEliminated = Object.entries(newTotals)
    .filter(([uid, pts]) =>
      pts >= game.targetScore &&
      !game.eliminatedPlayers.includes(uid)
    )
    .map(([uid]) => uid)

  const allEliminated = [...game.eliminatedPlayers, ...newlyEliminated]

  // Active players = total players minus eliminated
  const activePlayers = game.players.filter(p => !allEliminated.includes(p.uid))

  // Game ends when only 1 (or 0) active players remain
  let status: Game['status'] = 'active'
  let winner: string | null = null
  let finishedAt: number | null = null

  if (activePlayers.length <= 1) {
    status = 'finished'
    finishedAt = Date.now()
    if (activePlayers.length === 1) {
      // Last player standing wins
      winner = activePlayers[0].uid
    } else {
      // Everyone reached target simultaneously — pick lowest score
      winner = Object.entries(newTotals).reduce<string>((best, [uid, pts]) => {
        return pts < (newTotals[best] ?? Infinity) ? uid : best
      }, Object.keys(newTotals)[0])
    }
  }

  await updateDoc(gameRef, {
    totalScores: newTotals,
    eliminatedPlayers: allEliminated,
    status,
    winner,
    finishedAt,
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
  return snap.docs.map(d => ({
    id: d.id,
    eliminatedPlayers: [],
    ...d.data(),
  } as Game))
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
  return { id: d.id, eliminatedPlayers: [], ...d.data() } as Game
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
  const game = { eliminatedPlayers: [], ...gameSnap.data() } as Game

  // 3. Sum every round's scores from scratch
  const newTotals: Record<string, number> = {}
  game.players.forEach(p => { newTotals[p.uid] = 0 })

  allRoundsSnap.docs.forEach(d => {
    const scores = d.id === roundId ? newScores : (d.data().scores ?? {}) as Record<string, number>
    Object.entries(scores).forEach(([uid, pts]) => {
      newTotals[uid] = (newTotals[uid] ?? 0) + pts
    })
  })

  // 4. Recompute eliminations from new totals
  const newEliminated = game.players
    .filter(p => (newTotals[p.uid] ?? 0) >= game.targetScore)
    .map(p => p.uid)

  await updateDoc(gameRef, {
    totalScores: newTotals,
    eliminatedPlayers: newEliminated,
  })
}

export async function finishGameManually(gameId: string): Promise<void> {
  const gameRef = doc(db, 'games', gameId)
  const gameSnap = await getDoc(gameRef)
  if (!gameSnap.exists()) return

  const game = { eliminatedPlayers: [], ...gameSnap.data() } as Game

  // Winner = lowest score among non-eliminated players (or all if none active)
  const activePlayers = game.players.filter(p => !game.eliminatedPlayers.includes(p.uid))
  const pool = activePlayers.length > 0 ? activePlayers : game.players
  const winner = pool.reduce<string>((best, p) => {
    return (game.totalScores[p.uid] ?? 0) < (game.totalScores[best] ?? Infinity) ? p.uid : best
  }, pool[0].uid)

  await updateDoc(gameRef, {
    status: 'finished',
    winner,
    finishedAt: Date.now(),
  })
}
