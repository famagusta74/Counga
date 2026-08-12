import {
  db,
  auth,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  arrayUnion,
  arrayRemove,
  collection,
  query,
  where,
  orderBy,
  limit,
  Timestamp,
  serverTimestamp,
} from './config'
import type { Game, Round, Player, AppUser, Group, GroupInvite, UserSearchResult } from '../types'

// ── User helpers ───────────────────────────────────────────────────────────────

export async function upsertUser(user: AppUser): Promise<void> {
  const ref = doc(db, 'users', user.uid)
  await setDoc(ref, {
    displayName: user.displayName,
    // Stored lowercase for case-insensitive prefix search
    displayNameLower: user.displayName.toLowerCase(),
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
    roundCount: 0,
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
  const data = snap.data() as Record<string, unknown>
  return {
    eliminatedPlayers: [],
    roundCount: 0,
    ...data,
    id: snap.id,
  } as unknown as Game
}

export async function addRound(
  gameId: string,
  scores: Record<string, number>,
  roundNumber: number,
  roundWinnerUid: string | null = null,
): Promise<void> {
  const roundRef = doc(collection(db, 'games', gameId, 'rounds'))
  const round: Omit<Round, 'id'> = {
    roundNumber,
    scores,
    roundWinnerUid,
    createdAt: Date.now(),
  }
  await setDoc(roundRef, round)

  // Update cumulative totals
  const gameRef = doc(db, 'games', gameId)
  const gameSnap = await getDoc(gameRef)
  if (!gameSnap.exists()) return

  const game = { eliminatedPlayers: [] as string[], ...gameSnap.data() } as unknown as Game
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
    roundCount: (game.roundCount ?? 0) + 1,
    status,
    winner,
    finishedAt,
  })
}

/** Add a new player mid-game at the highest current total score */
export async function addPlayerToGame(
  gameId: string,
  player: Player,
  startingScore: number,
): Promise<void> {
  const gameRef  = doc(db, 'games', gameId)
  const gameSnap = await getDoc(gameRef)
  if (!gameSnap.exists()) return
  const game = { eliminatedPlayers: [] as string[], ...gameSnap.data() } as unknown as Game

  const updatedPlayers    = [...game.players, player]
  const updatedTotals     = { ...game.totalScores, [player.uid]: startingScore }

  await updateDoc(gameRef, {
    players:     updatedPlayers,
    totalScores: updatedTotals,
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
    eliminatedPlayers: [] as string[],
    roundCount: 0,
    ...d.data(),
    id: d.id,
  } as unknown as Game))
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
  return { eliminatedPlayers: [] as string[], roundCount: 0, ...d.data(), id: d.id } as unknown as Game
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
  const game = { eliminatedPlayers: [] as string[], ...gameSnap.data() } as unknown as Game

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

// ── Scan feedback (training data) ─────────────────────────────────────────────

export interface ScanFeedbackPayload {
  imageBase64: string               // compressed jpeg base64 (no data: prefix)
  detectedTokens: { token: string; points: number; count: number }[]
  aiScore: number
  correctedScore?: number           // filled in at confirm time; absent = no correction
  playerName: string
  gameId: string | null
}

export async function saveScanFeedback(payload: ScanFeedbackPayload): Promise<void> {
  const uid = auth.currentUser?.uid ?? 'anonymous'
  const ref = doc(collection(db, 'scanFeedback'))
  await setDoc(ref, {
    ...payload,
    uid,
    createdAt: serverTimestamp(),
  })
}

export async function finishGameManually(gameId: string): Promise<void> {
  const gameRef = doc(db, 'games', gameId)
  const gameSnap = await getDoc(gameRef)
  if (!gameSnap.exists()) return

  const game = { eliminatedPlayers: [] as string[], ...gameSnap.data() } as unknown as Game

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


/** Fetch basic profile info for a list of uids. */
export async function getUserProfiles(uids: string[]): Promise<Record<string, { displayName: string; email: string | null; photoURL: string | null }>> {
  if (uids.length === 0) return {}
  const results: Record<string, { displayName: string; email: string | null; photoURL: string | null }> = {}
  // Fetch in parallel (Firestore doesn't have a batch-get by uid in client SDK, so individual reads)
  await Promise.all(uids.map(async uid => {
    try {
      const snap = await getDoc(doc(db, 'users', uid))
      if (snap.exists()) {
        const d = snap.data()
        results[uid] = { displayName: d.displayName ?? uid, email: d.email ?? null, photoURL: d.photoURL ?? null }
      } else {
        results[uid] = { displayName: uid, email: null, photoURL: null }
      }
    } catch {
      results[uid] = { displayName: uid, email: null, photoURL: null }
    }
  }))
  return results
}


// ── Groups ─────────────────────────────────────────────────────────────────────

/** Search verified (non-guest) users by display name prefix. Max 10 results. */
export async function searchUsersByName(query_str: string): Promise<UserSearchResult[]> {
  if (!query_str.trim()) return []
  const lower = query_str.toLowerCase().trim()
  // Firestore prefix search: displayNameLower >= lower AND < lower + '\uf8ff'
  const snap = await getDocs(
    query(
      collection(db, 'users'),
      where('displayNameLower', '>=', lower),
      where('displayNameLower', '<', lower + '\uf8ff'),
      where('isGuest', '==', false),
      limit(10),
    )
  )
  const currentUid = auth.currentUser?.uid ?? ''
  return snap.docs
    .filter(d => d.id !== currentUid) // exclude self
    .map(d => {
      const data = d.data()
      return {
        uid: d.id,
        displayName: data.displayName ?? '',
        email: data.email ?? null,
        photoURL: data.photoURL ?? null,
      }
    })
}

/** Create a new group. Owner is automatically added as member. */
export async function createGroup(name: string): Promise<string> {
  const uid = auth.currentUser?.uid
  if (!uid) throw new Error('Must be signed in to create a group')
  const ref = doc(collection(db, 'groups'))
  const group: Omit<Group, 'id'> = {
    name: name.trim(),
    ownerUid: uid,
    memberUids: [uid],
    pendingInviteUids: [],
    createdAt: Date.now(),
  }
  await setDoc(ref, group)
  // Add groupId to owner's user doc
  await updateDoc(doc(db, 'users', uid), { groupIds: arrayUnion(ref.id) })
  return ref.id
}

/** Fetch all groups the current user belongs to. */
export async function getMyGroups(): Promise<Group[]> {
  const uid = auth.currentUser?.uid
  if (!uid) return []
  const snap = await getDocs(
    query(collection(db, 'groups'), where('memberUids', 'array-contains', uid))
  )
  return snap.docs.map(d => ({ id: d.id, ...d.data() } as Group))
}

/** Fetch a single group by id. */
export async function getGroup(groupId: string): Promise<Group | null> {
  const snap = await getDoc(doc(db, 'groups', groupId))
  if (!snap.exists()) return null
  return { id: snap.id, ...snap.data() } as Group
}

/**
 * Invite a verified user to a group.
 * Writes invite metadata to /groups/{groupId}/invites/{inviteeUid}
 * and also to /users/{inviteeUid}/pendingInvites/{groupId} for inbox display.
 */
export async function inviteUserToGroup(
  groupId: string,
  groupName: string,
  inviteeUid: string,
): Promise<void> {
  const ownerUid = auth.currentUser?.uid
  if (!ownerUid) throw new Error('Must be signed in')

  // Get owner display name
  const ownerSnap = await getDoc(doc(db, 'users', ownerUid))
  const ownerName: string = ownerSnap.exists() ? (ownerSnap.data().displayName ?? 'Someone') : 'Someone'

  const now = Date.now()

  // Mark invitee uid as pending on the group doc
  await updateDoc(doc(db, 'groups', groupId), {
    pendingInviteUids: arrayUnion(inviteeUid),
  })

  // Write invite to invitee's inbox (sub-collection for clean reads)
  const invite: GroupInvite = { groupId, groupName, ownerUid, ownerName, invitedAt: now }
  await setDoc(doc(db, 'users', inviteeUid, 'groupInvites', groupId), invite)
}

/** Get all pending group invites for the current user. */
export async function getPendingInvites(): Promise<GroupInvite[]> {
  const uid = auth.currentUser?.uid
  if (!uid) return []
  const snap = await getDocs(collection(db, 'users', uid, 'groupInvites'))
  return snap.docs.map(d => d.data() as GroupInvite)
}

/** Accept a group invite. */
export async function acceptGroupInvite(groupId: string): Promise<void> {
  const uid = auth.currentUser?.uid
  if (!uid) throw new Error('Must be signed in')

  const { deleteDoc } = await import('firebase/firestore')
  const inviteRef = doc(db, 'users', uid, 'groupInvites', groupId)

  await updateDoc(doc(db, 'groups', groupId), {
    memberUids: arrayUnion(uid),
    pendingInviteUids: arrayRemove(uid),
  })
  await updateDoc(doc(db, 'users', uid), { groupIds: arrayUnion(groupId) })
  await deleteDoc(inviteRef)
}

/** Decline (remove) a group invite. */
export async function declineGroupInvite(groupId: string): Promise<void> {
  const uid = auth.currentUser?.uid
  if (!uid) return
  const { deleteDoc } = await import('firebase/firestore')
  await updateDoc(doc(db, 'groups', groupId), {
    pendingInviteUids: arrayRemove(uid),
  })
  await deleteDoc(doc(db, 'users', uid, 'groupInvites', groupId))
}

/** Remove a member from a group (owner only). */
export async function removeMemberFromGroup(groupId: string, memberUid: string): Promise<void> {
  await updateDoc(doc(db, 'groups', groupId), {
    memberUids: arrayRemove(memberUid),
  })
  await updateDoc(doc(db, 'users', memberUid), {
    groupIds: arrayRemove(groupId),
  })
}

/** Rename a group (owner only). */
export async function renameGroup(groupId: string, newName: string): Promise<void> {
  await updateDoc(doc(db, 'groups', groupId), { name: newName.trim() })
}
