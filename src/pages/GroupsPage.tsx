import { useState, useEffect, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import {
  getMyGroups,
  getPendingInvites,
  acceptGroupInvite,
  declineGroupInvite,
  createGroup,
  getGroup,
  inviteUserToGroup,
  searchUsersByName,
  removeMemberFromGroup,
  renameGroup,
  getUserProfiles,
} from '../firebase/db'
import type { Group, GroupInvite, UserSearchResult } from '../types'
import {
  Users, Plus, ChevronRight, UserPlus, Check, X, Edit2, Trash2,
  Bell, Search, LogIn,
} from 'lucide-react'

export default function GroupsPage() {
  const { currentUser } = useAuth()
  const navigate = useNavigate()

  const [groups, setGroups]             = useState<Group[]>([])
  const [invites, setInvites]           = useState<GroupInvite[]>([])
  const [loading, setLoading]           = useState(true)
  const [loadError, setLoadError]       = useState('')

  // Create group
  const [showCreate, setShowCreate]     = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [creating, setCreating]         = useState(false)
  const [createError, setCreateError]   = useState('')

  // Selected group detail
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null)
  const [memberProfiles, setMemberProfiles] = useState<Record<string, { displayName: string; email: string | null; photoURL: string | null }>>({})
  const [detailLoading, setDetailLoading] = useState(false)

  // Invite flow inside selected group
  const [inviteQuery, setInviteQuery]   = useState('')
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([])
  const [searching, setSearching]       = useState(false)
  const [inviting, setInviting]         = useState<string | null>(null) // uid being invited
  const [inviteMsg, setInviteMsg]       = useState('')

  // Rename
  const [renaming, setRenaming]         = useState(false)
  const [renameVal, setRenameVal]       = useState('')
  const [renameSaving, setRenameSaving] = useState(false)

  const load = useCallback(async () => {
    if (!currentUser || currentUser.isGuest) { setLoading(false); return }
    setLoadError('')
    try {
      // Run independently so one failure doesn't block the other
      const [gsResult, invResult] = await Promise.allSettled([getMyGroups(), getPendingInvites()])
      if (gsResult.status === 'fulfilled') setGroups(gsResult.value)
      else console.error('getMyGroups failed:', gsResult.reason)
      if (invResult.status === 'fulfilled') setInvites(invResult.value)
      else console.error('getPendingInvites failed:', invResult.reason)
      // Only show an error if both failed
      if (gsResult.status === 'rejected' && invResult.status === 'rejected') {
        setLoadError('Could not load groups — check your Firestore rules are deployed. ' + String(gsResult.reason))
      }
    } finally {
      setLoading(false)
    }
  }, [currentUser])

  useEffect(() => { load() }, [load])

  // User-name search (debounced)
  useEffect(() => {
    if (!inviteQuery.trim() || inviteQuery.length < 2) { setSearchResults([]); return }
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const results = await searchUsersByName(inviteQuery)
        // Filter out existing members + pending
        const existingUids = new Set([
          ...(selectedGroup?.memberUids ?? []),
          ...(selectedGroup?.pendingInviteUids ?? []),
        ])
        setSearchResults(results.filter(r => !existingUids.has(r.uid)))
      } finally {
        setSearching(false)
      }
    }, 400)
    return () => clearTimeout(t)
  }, [inviteQuery, selectedGroup])

  const handleCreate = async () => {
    const name = newGroupName.trim()
    if (!name) { setCreateError('Enter a group name.'); return }
    setCreating(true); setCreateError('')
    try {
      await createGroup(name)
      setNewGroupName('')
      setShowCreate(false)
      await load()
    } catch {
      setCreateError('Failed to create group. Try again.')
    } finally {
      setCreating(false)
    }
  }

  const openGroup = async (g: Group) => {
    setDetailLoading(true)
    setInviteQuery(''); setSearchResults([]); setInviteMsg('')
    try {
      const fresh = await getGroup(g.id)
      setSelectedGroup(fresh)
      if (fresh) {
        const profiles = await getUserProfiles(fresh.memberUids)
        setMemberProfiles(profiles)
      }
    } finally {
      setDetailLoading(false)
    }
  }

  const handleInvite = async (user: UserSearchResult) => {
    if (!selectedGroup) return
    setInviting(user.uid)
    setInviteMsg('')
    try {
      await inviteUserToGroup(selectedGroup.id, selectedGroup.name, user.uid)
      setInviteMsg(`✓ Invite sent to ${user.displayName}`)
      setInviteQuery('')
      setSearchResults([])
      // Refresh group
      const fresh = await getGroup(selectedGroup.id)
      setSelectedGroup(fresh)
      if (fresh) {
        const profiles = await getUserProfiles(fresh.memberUids)
        setMemberProfiles(profiles)
      }
    } catch {
      setInviteMsg('Failed to send invite. Try again.')
    } finally {
      setInviting(null)
    }
  }

  const handleAccept = async (invite: GroupInvite) => {
    try {
      await acceptGroupInvite(invite.groupId)
      await load()
    } catch { /* ignore */ }
  }

  const handleDecline = async (invite: GroupInvite) => {
    try {
      await declineGroupInvite(invite.groupId)
      await load()
    } catch { /* ignore */ }
  }

  const handleRemoveMember = async (uid: string) => {
    if (!selectedGroup) return
    await removeMemberFromGroup(selectedGroup.id, uid)
    const fresh = await getGroup(selectedGroup.id)
    setSelectedGroup(fresh)
    if (fresh) {
      const profiles = await getUserProfiles(fresh.memberUids)
      setMemberProfiles(profiles)
    }
    await load()
  }

  const handleRename = async () => {
    if (!selectedGroup || !renameVal.trim()) return
    setRenameSaving(true)
    try {
      await renameGroup(selectedGroup.id, renameVal)
      const fresh = await getGroup(selectedGroup.id)
      setSelectedGroup(fresh)
      setRenaming(false)
      await load()
    } finally {
      setRenameSaving(false)
    }
  }

  if (!currentUser || currentUser.isGuest) {
    return (
      <div className="space-y-4 pb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Groups</h1>
          <p className="text-sm text-gray-500 mt-1">Only available for Google accounts</p>
        </div>
        <div className="card text-center py-12 space-y-4">
          <Users size={40} className="mx-auto text-gray-300" />
          <div>
            <p className="font-semibold text-gray-700">Sign in with Google to use Groups</p>
            <p className="text-sm text-gray-400 mt-1">
              Create permanent groups of friends &amp; family for quick game setup.
            </p>
          </div>
          <button onClick={() => navigate('/login')} className="btn-primary mx-auto gap-2">
            <LogIn size={16} /> Sign in with Google
          </button>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-600" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="space-y-4 pb-6">
        <h1 className="text-2xl font-bold text-gray-900">Groups</h1>
        <div className="card text-center py-10 space-y-3">
          <p className="text-red-600 font-medium">{loadError}</p>
          <button onClick={load} className="btn-primary mx-auto">Retry</button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5 pb-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Groups</h1>
          <p className="text-sm text-gray-500 mt-1">
            Create groups to quickly start games with the same people
          </p>
        </div>
        <button
          onClick={() => { setShowCreate(v => !v); setCreateError(''); setNewGroupName('') }}
          className="btn-primary px-3 py-2 gap-1.5 text-sm"
        >
          <Plus size={16} /> New
        </button>
      </div>

      {/* ── Create group form ── */}
      {showCreate && (
        <div className="card space-y-3">
          <p className="text-sm font-semibold text-gray-800">New group name</p>
          <input
            type="text"
            value={newGroupName}
            onChange={e => { setNewGroupName(e.target.value); setCreateError('') }}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            placeholder="e.g. Family, Friday Night…"
            className="input"
            maxLength={40}
            autoFocus
          />
          {createError && <p className="text-xs text-red-600">{createError}</p>}
          <div className="flex gap-2">
            <button onClick={() => setShowCreate(false)} className="btn-secondary flex-1">Cancel</button>
            <button onClick={handleCreate} disabled={creating || !newGroupName.trim()} className="btn-primary flex-1 gap-2">
              {creating ? <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" /> : <><Plus size={15} /> Create</>}
            </button>
          </div>
        </div>
      )}

      {/* ── Pending invites ── */}
      {invites.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-2">
            <Bell size={15} className="text-brand-600" />
            <h2 className="text-sm font-semibold text-gray-700">Pending invitations ({invites.length})</h2>
          </div>
          <ul className="space-y-2">
            {invites.map(inv => (
              <li key={inv.groupId} className="card flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{inv.groupName}</p>
                  <p className="text-xs text-gray-400">From {inv.ownerName}</p>
                </div>
                <button
                  onClick={() => handleDecline(inv)}
                  className="w-8 h-8 rounded-full border border-gray-200 flex items-center justify-center text-gray-400 hover:text-red-500 hover:border-red-200 active:bg-red-50 transition-colors"
                  title="Decline"
                >
                  <X size={15} />
                </button>
                <button
                  onClick={() => handleAccept(inv)}
                  className="w-8 h-8 rounded-full bg-brand-600 flex items-center justify-center text-white hover:bg-brand-700 active:bg-brand-800 transition-colors"
                  title="Accept"
                >
                  <Check size={15} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Groups list ── */}
      {groups.length === 0 && invites.length === 0 && (
        <div className="card text-center py-12">
          <Users size={36} className="mx-auto mb-3 text-gray-300" />
          <p className="font-semibold text-gray-700">No groups yet</p>
          <p className="text-sm text-gray-400 mt-1">
            Create a group and invite your regular players for one-tap game setup.
          </p>
        </div>
      )}

      {groups.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">My Groups</h2>
          <ul className="space-y-2">
            {groups.map(g => (
              <li key={g.id}>
                <button
                  onClick={() => openGroup(g)}
                  className="card w-full flex items-center gap-3 hover:border-brand-200 transition-colors text-left"
                >
                  <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center flex-shrink-0">
                    <Users size={18} className="text-brand-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{g.name}</p>
                    <p className="text-xs text-gray-400">{g.memberUids.length} member{g.memberUids.length !== 1 ? 's' : ''}</p>
                  </div>
                  {g.ownerUid === currentUser?.uid && (
                    <span className="badge badge-blue text-xs">owner</span>
                  )}
                  <ChevronRight size={16} className="text-gray-400 flex-shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Group detail sheet ── */}
      {selectedGroup && (
        <div className="fixed inset-0 z-[60] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden flex flex-col"
               style={{ maxHeight: 'calc(100dvh - env(safe-area-inset-bottom, 0px) - 56px)' }}>

            {/* Header */}
            <div className="bg-brand-950 text-white px-5 py-4 flex-shrink-0 flex items-center justify-between">
              <div className="flex-1 min-w-0 pr-3">
                {renaming ? (
                  <input
                    className="bg-brand-800 text-white rounded-lg px-3 py-1.5 text-sm font-bold w-full focus:outline-none focus:ring-2 focus:ring-brand-400"
                    value={renameVal}
                    onChange={e => setRenameVal(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleRename() }}
                    autoFocus
                  />
                ) : (
                  <div>
                    <h3 className="font-bold text-base truncate">{selectedGroup.name}</h3>
                    <p className="text-xs text-brand-300">{selectedGroup.memberUids.length} members</p>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {selectedGroup.ownerUid === currentUser?.uid && (
                  renaming ? (
                    <>
                      <button onClick={handleRename} disabled={renameSaving} className="p-1.5 rounded-lg bg-brand-700 hover:bg-brand-600">
                        {renameSaving ? <span className="animate-spin rounded-full h-3 w-3 border-b-2 border-white block" /> : <Check size={15} />}
                      </button>
                      <button onClick={() => setRenaming(false)} className="p-1.5 rounded-lg bg-brand-700 hover:bg-brand-600">
                        <X size={15} />
                      </button>
                    </>
                  ) : (
                    <button onClick={() => { setRenaming(true); setRenameVal(selectedGroup.name) }} className="p-1.5 rounded-lg hover:bg-brand-800">
                      <Edit2 size={15} />
                    </button>
                  )
                )}
                <button onClick={() => { setSelectedGroup(null); setRenaming(false) }} className="p-1.5 rounded-lg hover:bg-brand-800">
                  <X size={18} />
                </button>
              </div>
            </div>

            {detailLoading ? (
              <div className="flex-1 flex items-center justify-center py-10">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto pb-safe" style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 16px)' }}>

                {/* Use group to start a game */}
                <div className="px-5 py-3 bg-brand-50 border-b border-brand-100">
                  <button
                    onClick={() => {
                      navigate('/new-game', { state: { groupId: selectedGroup.id, groupName: selectedGroup.name } })
                      setSelectedGroup(null)
                    }}
                    className="btn-primary w-full py-3 gap-2"
                  >
                    <Plus size={16} /> Start game with this group
                  </button>
                </div>

                {/* Members */}
                <div className="divide-y divide-gray-100">
                  {selectedGroup.memberUids.map(uid => {
                    const isOwner = uid === selectedGroup.ownerUid
                    const isMe = uid === currentUser?.uid
                    const profile = memberProfiles[uid]
                    const displayName = isMe
                      ? `${currentUser.displayName} (you)`
                      : (profile?.displayName ?? uid)
                    return (
                      <div key={uid} className="flex items-center gap-3 px-5 py-3">
                        <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0 text-sm font-bold text-brand-700">
                          {displayName.charAt(0).toUpperCase()}
                        </div>
                        <Link to={`/player/${uid}`} onClick={() => setSelectedGroup(null)} className="flex-1 min-w-0 min-h-0">
                          <p className="text-sm font-medium truncate">{displayName}</p>
                          {profile?.email && !isMe && <p className="text-xs text-gray-400 truncate">{profile.email}</p>}
                          {isOwner && <p className="text-xs text-brand-600">owner</p>}
                        </Link>
                        {selectedGroup.ownerUid === currentUser?.uid && !isMe && (
                          <button
                            onClick={() => handleRemoveMember(uid)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                            title="Remove from group"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    )
                  })}

                  {/* Pending invites */}
                  {(selectedGroup.pendingInviteUids?.length ?? 0) > 0 && (
                    <div className="px-5 py-2 bg-amber-50 border-t border-amber-100">
                      <p className="text-xs text-amber-700 font-medium mb-1">Awaiting response</p>
                      {selectedGroup.pendingInviteUids.map(uid => (
                        <p key={uid} className="text-xs text-amber-600 truncate">· {uid}</p>
                      ))}
                    </div>
                  )}
                </div>

                {/* Invite section — owner only */}
                {selectedGroup.ownerUid === currentUser?.uid && (
                  <div className="px-5 py-4 border-t border-gray-100 space-y-3">
                    <p className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                      <UserPlus size={15} className="text-brand-600" />
                      Invite by name
                    </p>
                    <div className="relative">
                      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                      <input
                        type="text"
                        value={inviteQuery}
                        onChange={e => setInviteQuery(e.target.value)}
                        placeholder="Search verified users…"
                        className="input pl-9"
                      />
                    </div>
                    {searching && (
                      <div className="flex items-center gap-2 text-xs text-gray-400">
                        <span className="animate-spin rounded-full h-3 w-3 border-b-2 border-brand-400 block" />
                        Searching…
                      </div>
                    )}
                    {searchResults.length > 0 && (
                      <ul className="space-y-1">
                        {searchResults.map(u => (
                          <li key={u.uid} className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2.5">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{u.displayName}</p>
                              {u.email && <p className="text-xs text-gray-400 truncate">{u.email}</p>}
                            </div>
                            <button
                              onClick={() => handleInvite(u)}
                              disabled={inviting === u.uid}
                              className="btn-primary text-xs px-3 py-1.5 gap-1.5 flex-shrink-0"
                            >
                              {inviting === u.uid
                                ? <span className="animate-spin rounded-full h-3 w-3 border-b-2 border-white block" />
                                : <><UserPlus size={12} /> Invite</>
                              }
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {inviteQuery.length >= 2 && !searching && searchResults.length === 0 && (
                      <div className="text-xs text-gray-400 space-y-1">
                        <p>No verified users found matching "{inviteQuery}".</p>
                        <p className="text-gray-400">They must have signed in with Google at least once to appear here.</p>
                      </div>
                    )}
                    {inviteMsg && (
                      <p className={`text-xs font-medium ${inviteMsg.startsWith('✓') ? 'text-green-600' : 'text-red-600'}`}>
                        {inviteMsg}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
