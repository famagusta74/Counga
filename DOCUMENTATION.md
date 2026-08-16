# Counga Score Keeper — Technical Documentation

> Version 1.11.0 · React 18 · TypeScript · Firebase · Vite · Tailwind CSS · PWA

---

## Table of Contents

1. [Overview](#overview)
2. [Game Rules & Scoring](#game-rules--scoring)
3. [Architecture](#architecture)
4. [Tech Stack](#tech-stack)
5. [Project Structure](#project-structure)
6. [Authentication & User Model](#authentication--user-model)
7. [Data Model (Firestore)](#data-model-firestore)
8. [Routing](#routing)
9. [Pages](#pages)
10. [Components](#components)
11. [Firebase Layer](#firebase-layer)
12. [AI Card Detection (Google Cloud Vision)](#ai-card-detection-google-cloud-vision)
13. [Scoring Logic](#scoring-logic)
14. [Groups & Social Features](#groups--social-features)
15. [Player Profiles & Statistics](#player-profiles--statistics)
16. [PWA & Deployment](#pwa--deployment)
17. [Environment Variables](#environment-variables)
18. [Firestore Security Rules](#firestore-security-rules)
19. [Development & Build Scripts](#development--build-scripts)

---

## Overview

Counga Score Keeper is a **mobile-first Progressive Web App (PWA)** built to track scores for the Counga card game. It is hosted on GitHub Pages and designed to run on any modern smartphone or browser without installation.

Key capabilities:
- **Google sign-in** or **anonymous guest** play
- Create game sessions with configurable target scores
- Score each player's remaining hand after each round using a **camera + AI** or a manual card-picker UI
- **Real-time shared view** — any participant opening the game URL sees live score updates without refreshing
- **Share** button to send the game link to the other players (Web Share API or clipboard fallback)
- Game history and Home dashboard filtered to **only the current user's games**
- Automatic elimination when a player reaches the target score
- **Groups** system for recurring player sets
- Per-player statistics (win rates, rounds played)
- Full game history with round-by-round breakdown
- Offline-capable via PWA service worker

---

## Game Rules & Scoring

Counga is a shedding-style card game. After each round, players count the point value of the cards **remaining in their hand**. Scores accumulate across rounds. The **lowest total score wins** — the game ends when any player reaches (or exceeds) the configured target score, at which point they are **eliminated**. The last player standing is the winner.

### Card Point Values

| Rank         | Points   |
|--------------|----------|
| Joker        | 25       |
| Ace (A)      | 11       |
| J, Q, K      | 10 each  |
| 10           | 10       |
| 2 – 9        | Face value (2–9) |

A player who wins a round (empties their hand first) scores **0 points** for that round, marked with a ⭐ in the scoreboard.

### Elimination

Each time a round is recorded, the app recomputes every player's cumulative score. Players whose total meets or exceeds `targetScore` are added to `eliminatedPlayers`. The game ends automatically when only one active (non-eliminated) player remains. If all players are eliminated simultaneously in the same round, the player with the lowest total wins.

---

## Architecture

```
Browser (React SPA)
        │
        ├── React Router (client-side routing, basename /Counga)
        ├── AuthContext (Firebase Auth state)
        │
        ├── Pages (route handlers)
        │     ├── LoginPage
        │     ├── HomePage
        │     ├── NewGamePage
        │     ├── GamePage  ──► CardPicker (camera + AI)
        │     ├── HistoryPage
        │     ├── GroupsPage
        │     └── PlayerProfilePage
        │
        ├── Components
        │     ├── Layout (header, bottom nav, outlet)
        │     ├── ScoreTable (round matrix, inline edit)
        │     └── CardPicker (camera capture, Vision API, manual grid)
        │
        └── Firebase SDK
              ├── Authentication (Google OAuth, Anonymous)
              └── Firestore (games, rounds, users, groups, scanFeedback)
```

The app is a **pure SPA** — there is no server-side component. All business logic runs in the browser, and Firebase provides the persistence and auth layers.

---

## Tech Stack

| Layer | Technology |
|---|---|
| UI Framework | React 18 with functional components & hooks |
| Language | TypeScript 5 |
| Routing | React Router DOM v6 |
| Styling | Tailwind CSS v3 + PostCSS |
| Build | Vite 5 |
| PWA | vite-plugin-pwa (Workbox) |
| Backend | Firebase (Firestore + Authentication) |
| AI | Google Cloud Vision API v1 |
| Camera | react-webcam |
| Icons | lucide-react |
| Deployment | GitHub Pages via `gh-pages` |

---

## Project Structure

```
src/
├── App.tsx                  # Root: providers, router, route guard
├── main.tsx                 # ReactDOM.createRoot entry point
├── index.css                # Tailwind base + custom component classes
│
├── components/
│   ├── CardPicker.tsx       # Camera capture + AI + manual card entry
│   ├── Layout.tsx           # App shell: header, main area, bottom nav
│   └── ScoreTable.tsx       # Round-by-round score matrix with edit
│
├── contexts/
│   └── AuthContext.tsx      # Firebase Auth state + guest/Google helpers
│
├── firebase/
│   ├── config.ts            # Firebase init, re-exports SDK helpers
│   └── db.ts                # All Firestore read/write helpers
│
├── pages/
│   ├── HomePage.tsx         # Dashboard: active games, recent results
│   ├── LoginPage.tsx        # Google sign-in / guest entry
│   ├── NewGamePage.tsx      # Create game: target score + player picker
│   ├── GamePage.tsx         # Live game: round flow, CardPicker, standings
│   ├── HistoryPage.tsx      # Full game history list
│   ├── GroupsPage.tsx       # Create/manage groups, invite players
│   └── PlayerProfilePage.tsx # Stats + game history for one player
│
├── types/
│   └── index.ts             # Shared TypeScript interfaces
│
└── utils/
    └── scoring.ts           # CARD_POINTS map, calculateHandScore, rankMedal
```

---

## Authentication & User Model

### Auth flow (`src/contexts/AuthContext.tsx`)

The `AuthProvider` wraps the entire app and exposes:

| Method | Description |
|---|---|
| `signInWithGoogle()` | Opens a popup using `signInWithPopup`. Called directly from a user-gesture handler to satisfy iOS WebKit's popup policy. On success, calls `upsertUser` to persist the profile in Firestore. |
| `signInAsGuest(name)` | Calls Firebase `signInAnonymously`. Stores the display name in `sessionStorage` (not Firestore). Guest sessions do not persist across browser sessions. |
| `upgradeGuestToGoogle()` | Links the anonymous account to a Google credential using `linkWithPopup`, then upserts the user in Firestore and clears the guest name from session storage. |
| `logout()` | Signs out, clears `sessionStorage`, sets `currentUser` to null. |

### AppUser type

```ts
interface AppUser {
  uid: string
  displayName: string
  email: string | null
  isGuest: boolean     // true = anonymous Firebase session
  photoURL?: string | null
}
```

Guests (`isGuest: true`) can play but cannot access History or Groups. They are shown an upgrade prompt where relevant.

### `RequireAuth` guard (`src/App.tsx`)

All routes except `/login` are wrapped by `RequireAuth`, which redirects unauthenticated users to `/login` and shows a spinner while Firebase resolves the initial auth state.

---

## Data Model (Firestore)

### Collection: `users/{uid}`

Stores the public profile for each Google-authenticated user. Written on every sign-in via `upsertUser`.

| Field | Type | Description |
|---|---|---|
| `displayName` | string | User's display name |
| `displayNameLower` | string | Lowercase version for prefix search |
| `email` | string \| null | Google email |
| `isGuest` | boolean | Always false for this collection |
| `photoURL` | string \| null | Google profile photo |
| `updatedAt` | Timestamp | Last updated |

### Sub-collection: `users/{uid}/groupInvites/{groupId}`

Stores pending group invitations for fast inbox lookup.

| Field | Type | Description |
|---|---|---|
| `groupId` | string | The group's Firestore ID |
| `groupName` | string | Snapshot of group name at invite time |
| `ownerUid` | string | UID of the group owner |
| `ownerName` | string | Display name of the owner |
| `invitedAt` | number | Unix timestamp |

### Collection: `games/{gameId}`

One document per game session.

| Field | Type | Description |
|---|---|---|
| `targetScore` | number | Points at which a player is eliminated |
| `status` | `'active' \| 'finished' \| 'abandoned'` | Game state |
| `players` | `Player[]` | Full player list (including eliminated) |
| `playerUids` | `string[]` | Flat array of all player UIDs — used for `array-contains` queries to filter games by participant. Kept in sync when players are added mid-game. |
| `eliminatedPlayers` | `string[]` | UIDs who have exceeded target |
| `totalScores` | `Record<string, number>` | Cumulative score per UID |
| `winner` | `string \| null` | UID of the winner |
| `roundCount` | number | Total rounds submitted |
| `createdAt` | number | Unix timestamp |
| `finishedAt` | number \| null | Unix timestamp when game ended |
| `createdBy` | string | UID of the creator |

### Sub-collection: `games/{gameId}/rounds/{roundId}`

One document per round.

| Field | Type | Description |
|---|---|---|
| `roundNumber` | number | 1-indexed round counter |
| `scores` | `Record<string, number>` | Points for this round per UID |
| `roundWinnerUid` | `string \| null` | UID of the player who won the round (0 pts) |
| `createdAt` | number | Unix timestamp |

### Collection: `groups/{groupId}`

| Field | Type | Description |
|---|---|---|
| `name` | string | Group display name |
| `ownerUid` | string | Creator's UID |
| `memberUids` | `string[]` | Confirmed members (includes owner) |
| `pendingInviteUids` | `string[]` | Invited but not yet accepted |
| `createdAt` | number | Unix timestamp |

### Collection: `scanFeedback/{docId}`

Stores AI scan results for quality analysis. Written after each card scan confirmation.

| Field | Type | Description |
|---|---|---|
| `imageBase64` | string | Compressed JPEG, no data: prefix |
| `detectedTokens` | array | Tokens, points, counts from Vision |
| `aiScore` | number | Score as computed by AI |
| `correctedScore` | number (optional) | User-corrected score if different |
| `playerName` | string | Player whose hand was scanned |
| `gameId` | string \| null | Associated game |
| `uid` | string | Submitter UID |

---

## Routing

All routes are nested under `basename="/Counga"` to match the GitHub Pages subdirectory.

| Path | Page | Auth required |
|---|---|---|
| `/login` | `LoginPage` | No |
| `/` | `HomePage` | Yes |
| `/new-game` | `NewGamePage` | Yes |
| `/game/:gameId` | `GamePage` | Yes |
| `/history` | `HistoryPage` | Yes |
| `/groups` | `GroupsPage` | Yes |
| `/player/:uid` | `PlayerProfilePage` | Yes |
| `*` | Redirect to `/` | — |

The `Layout` component renders the persistent header and bottom navigation bar for all authenticated routes. The active route is highlighted using React Router's `NavLink` active class.

---

## Pages

### LoginPage (`src/pages/LoginPage.tsx`)

Entry point for unauthenticated users. Two options:
1. **Continue with Google** — triggers `signInWithGoogle()`. Handles popup-blocked and popup-closed-by-user errors with user-friendly messages.
2. **Play as Guest** — optional name input, triggers `signInAsGuest()`.

Redirects to `/` on successful auth via a `useEffect` watching `currentUser`.

---

### HomePage (`src/pages/HomePage.tsx`)

Dashboard shown after login. Fetches the 5 most recent games on mount, splits them into active and finished. Shows:
- Welcome banner with user name and status
- **Active games** list with "Live" badge — tapping resumes the game
- **Recent results** list with winner and player count
- A pending group invite badge on the Groups button (for verified users)
- Card values cheatsheet

---

### NewGamePage (`src/pages/NewGamePage.tsx`)

Configure and launch a new game. Features:
- **Target score** picker: preset buttons (100, 150, 200, 300, 500) plus a custom number input
- **Player list**: the signed-in user is pre-added and cannot be removed
- **Live user search**: for verified (Google) users, typing in the player input queries `searchUsersByName` with a 350ms debounce and shows a dropdown of matching accounts with "verified" badges
- Guest players can be added by name, getting a generated `guest_<timestamp>_<random>` UID
- **Group pre-fill**: when navigated from `GroupsPage` with `{ groupId, groupName }` in router state, the group's member UIDs are pre-loaded
- **Active game gate**: checks for an existing active game on mount. If one is found, shows a modal giving the user the option to resume or abandon it before starting a new one

---

### GamePage (`src/pages/GamePage.tsx`)

The core gameplay screen. Uses **Firestore `onSnapshot` real-time listeners** for both the game document and its rounds sub-collection. Any participant who opens the game URL (shared via the Share button) sees all score changes live without refreshing — this is the primary "shared scorekeeper" mechanism.

#### Live sync architecture

Two listeners are registered on mount and cleaned up on unmount:
- `subscribeToGame(gameId, cb)` — fires whenever the game document changes (totals, eliminations, status)
- `subscribeToRounds(gameId, cb)` — fires whenever any round is added or edited

Because the listeners continuously update state, manual `getGame`/`getRounds` re-fetches after writes have been removed. The app is always in sync.

#### Round flow

1. Tap **Add Round** → opens `CardPicker` for the first active player
2. After confirming a player's score, the picker advances to the next player
3. **Auto-winner suggestion**: when reaching the last player, if all previous scores are > 0, a prompt asks whether that player won the round (score = 0). This can also be triggered at any point via the "Won this round" button inside `CardPicker`
4. After all players are scored, `addRound` is called:
   - Cumulative totals are updated
   - Players who hit or exceed `targetScore` are eliminated
   - If only 1 (or 0) active players remain, the game is marked `finished`
5. A **post-round standings modal** is shown summarising the round result and any eliminations

#### Other features

- **Share button**: opens the Web Share sheet (mobile) or copies the URL to the clipboard with a "Copied!" confirmation, so any player can open the live game on their own device
- **Mid-game player addition**: add a new player mid-game with a transparent starting-score preview ("Starts at X pts — same as [leader]")
- **Change target score**: any player can modify the target mid-game; requires checking a confirmation checkbox ("all players have agreed")
- **Finish game manually**: end the game early via a confirmation modal
- **Round editing**: tap the pencil icon on any round column header in the score table to edit that round's scores — `updateRound` now fully replays all rounds to recompute totals, eliminations, and game status/winner correctly
- **Guest upgrade prompt**: guest users see an inline prompt to link a Google account
- **Winner screen**: a trophy celebration overlay is shown when the game finishes, displaying the winner's name and final scores

---

### HistoryPage (`src/pages/HistoryPage.tsx`)

Lists up to 30 recent games for verified users **that the current user participated in** (as creator or player). Shows per-game: status, date, round count, winner, player list, and a mini score ranking. Tapping a game navigates to its `GamePage` for review.

Guest users see a wall prompting them to sign in with Google, with an inline upgrade button.

---

### GroupsPage (`src/pages/GroupsPage.tsx`)

Full group management UI. Features:
- List of groups the user owns or is a member of
- Create a new group (Google users only)
- Per-group management: search and invite users, view members, remove members, rename group, delete group
- **Invite inbox**: pending invites received from other users, with accept/decline actions
- Tapping "Start Game" on a group navigates to `NewGamePage` with the group pre-loaded

---

### PlayerProfilePage (`src/pages/PlayerProfilePage.tsx`)

Accessible at `/player/:uid`. Shows:
- Display name and avatar initial
- **Games KPIs**: games played, wins, losses, and a circular win-rate gauge
- **Rounds KPIs**: rounds played, wins, losses, and a circular win-rate gauge
- **Full game history** (own profile only): each game with rank medal, opponent names, outcome, and personal score

Stats are computed server-side in `getPlayerStats` by querying the `games` collection.

---

## Components

### Layout (`src/components/Layout.tsx`)

Persistent app shell. Contains:
- **Sticky header**: app name, version, current user avatar/name, sign-out button
- **Main area**: `<Outlet />` renders the active page
- **Sticky bottom nav**: Home, New Game, History, Groups — each a `NavLink` with active highlighting

### ScoreTable (`src/components/ScoreTable.tsx`)

Horizontally scrollable table rendering all rounds and cumulative totals. Players are sorted by ascending total score (lowest first). Features:
- Round winner cells shown with ⭐ and gold highlight
- Eliminated players shown with strikethrough
- Game winner shown with 👑
- Totals shown in red when over target
- Inline round edit: tap the pencil on a column header to open a modal with +/− controls for each player's score in that round

### CardPicker (`src/components/CardPicker.tsx`)

The most complex component. A two-phase UI:

**Phase 1 — Shoot**: Uses `react-webcam` to capture a photo of the player's remaining cards. The user can also upload an image from the device gallery.

**Phase 2 — Review**: The captured image is:
1. Compressed to max 1024 px wide, JPEG quality 0.6 via a canvas element
2. Sent to the Google Cloud Vision API (`DOCUMENT_TEXT_DETECTION` + `OBJECT_LOCALIZATION`)
3. The response is parsed by `parseFullText` to extract card ranks and estimate a score
4. The AI result is displayed with detected tokens and a proposed total

The user can:
- Accept the AI score as-is
- Adjust individual card counts using + / − buttons
- Override the total manually
- Mark the player as the round winner (0 pts)
- View the raw Vision API response (debug mode)
- Re-shoot if the scan is poor

On confirm, `saveScanFeedback` is called **once** to log the scan image, detected tokens, AI score, and any user correction to Firestore for quality monitoring. A `useEffect` cleanup ensures the camera `MediaStream` is stopped when the component unmounts (e.g. if the user navigates away mid-scan), preventing the browser camera indicator from staying on.

---

## Firebase Layer

All Firestore interactions are centralised in `src/firebase/db.ts`. Key functions:

| Function | Description |
|---|---|
| `upsertUser(user)` | Merge-writes user profile. Stores `displayNameLower` for search. |
| `createGame(target, players)` | Creates a new game document with zeroed totals. Also writes `playerUids` (flat UID array) for participant queries. |
| `getGame(gameId)` | Fetches a single game document (one-off read). |
| `subscribeToGame(gameId, cb)` | **Live listener** — calls `cb` with the latest `Game` on every Firestore change. Returns an `Unsubscribe` function. |
| `subscribeToRounds(gameId, cb)` | **Live listener** — calls `cb` with all rounds sorted by `roundNumber` on every change. Returns an `Unsubscribe` function. |
| `addRound(gameId, scores, roundNumber, winnerUid)` | Writes the round, recomputes totals, eliminates players, and may finish the game. |
| `updateRound(gameId, roundId, newScores)` | Replays all rounds in order to recompute totals, eliminations, **and game status/winner** from scratch after an edit. |
| `addPlayerToGame(gameId, player, startingScore)` | Appends a player mid-game at the specified starting score. Keeps `playerUids` in sync. |
| `getRounds(gameId)` | Returns all rounds ordered by `roundNumber` (one-off read). |
| `getRecentGames(count)` | Returns the N most recent games the **current user participated in** (by `createdBy` or `playerUids` array-contains), merged and deduplicated. |
| `getActiveGameForUser(uid)` | Queries for an active game created by the given user. |
| `updateTargetScore(gameId, newTarget)` | Updates `targetScore` on a game document. |
| `abandonGame(gameId)` | Sets game status to `'abandoned'`. |
| `finishGameManually(gameId)` | Marks game as `finished`, sets winner to lowest scorer. |
| `saveScanFeedback(payload)` | Writes **one** feedback record at confirm time with final tokens, AI score, and correction if any. |
| `getUserProfiles(uids)` | Batch-fetches user profiles by UID array. |
| `searchUsersByName(query)` | Substring searches `displayName` client-side from up to 200 non-guest users. |
| `createGroup(name)` | Creates a group with the current user as owner and first member. |
| `getMyGroups()` | Returns groups where the current user is a member. |
| `inviteUserToGroup(groupId, uid)` | Adds UID to `pendingInviteUids` and writes an invite doc to the user's sub-collection. |
| `acceptGroupInvite(groupId)` | Moves the user from `pendingInviteUids` to `memberUids`. |
| `declineGroupInvite(groupId)` | Removes the user from `pendingInviteUids` and deletes the invite doc. |
| `getPlayerStats(uid)` | Computes win/loss stats by querying all finished games involving the player. |
| `getGamesForPlayer(uid, count)` | Returns up to N finished games where the player participated. |

---

## AI Card Detection (Google Cloud Vision)

The card detection pipeline in `CardPicker` uses the **Google Cloud Vision API** and reuses the Firebase API key (`VITE_FIREBASE_API_KEY`) as the Vision API credential.

### Pipeline

```
Camera capture
      │
      ▼
compressImage()          — canvas resize to max 1024px, JPEG 0.6
      │
      ▼
analyseImage(base64)     — POST to vision.googleapis.com/v1/images:annotate
      │           features: DOCUMENT_TEXT_DETECTION, OBJECT_LOCALIZATION
      ▼
parseFullText(text)      — primary parse path
      │  1. Split full-text into whitespace tokens
      │  2. Regex-match rank+suit combos ("Q♥", "10♠")
      │  3. normaliseRank() → canonical token
      │  4. Tally occurrences, cap at MAX_PER_RANK = 2
      │  5. Multiply by CARD_POINTS, sum
      ▼
parseWordAnnotations()   — fallback when fullTextAnnotation absent
      │
      ▼
DetectedToken[]  +  computed score
```

### Rank normalisation (`normaliseRank`)

Handles all textual forms Vision may return:
- Strips suit symbols: ♠ ♥ ♦ ♣ S H D C
- Strips non-alphanumeric noise (unicode box chars, punctuation)
- Maps variants: `"ACE"→A`, `"KING"→K`, `"J0KER"→JOKER`, `"1O"→10`, etc.

### MAX_PER_RANK cap

Rather than dividing Vision's hit count by 2 (which misfires when Vision reads centre-of-card text), each rank's occurrence count is capped at 2. This matches the physical maximum of two same-rank cards in a player's hand.

---

## Scoring Logic

`src/utils/scoring.ts` exports three utilities:

```ts
// Card → points map
const CARD_POINTS: Record<CardRank, number>

// Sum points across a list of { rank, count } pairs
function calculateHandScore(cards: { rank: CardRank; count: number }[]): number

// Returns medal emoji for 1st/2nd/3rd, else "#N"
function rankMedal(position: number): string
```

The `addRound` server function and the CardPicker both independently implement the same scoring map to ensure consistency between AI-assisted and manual entry.

---

## Groups & Social Features

Groups are created by verified (Google-authenticated) users only. Anonymous users cannot create or own groups.

### Group lifecycle

1. **Create**: `createGroup(name)` writes the group document with `ownerUid = currentUser.uid` and `memberUids = [ownerUid]`
2. **Invite**: `inviteUserToGroup(groupId, targetUid)` adds the target to `pendingInviteUids` and writes a `GroupInvite` doc to `users/{targetUid}/groupInvites/{groupId}`
3. **Accept**: `acceptGroupInvite(groupId)` uses `arrayUnion` / `arrayRemove` to move the user from pending to member
4. **Decline**: Removes from pending and deletes the invite doc
5. **Remove member**: Owner can remove any member via `removeMemberFromGroup`
6. **Rename**: Owner can rename via `renameGroup`
7. **Delete**: Owner deletes the group document (Firestore rules enforce owner-only)

### Starting a game from a group

`GroupsPage` passes `{ groupId, groupName }` as React Router location state when navigating to `NewGamePage`. `NewGamePage` reads this state on mount, fetches the group, and pre-populates the player list with all `memberUids`.

---

## Player Profiles & Statistics

`getPlayerStats(uid)` computes statistics by querying:
1. All finished games where the player appears in `players`
2. All rounds sub-collections for those games

Computed fields:

| Field | Computation |
|---|---|
| `gamesPlayed` | Count of finished games involving the player |
| `gameWins` | Games where `winner === uid` |
| `gameLosses` | `gamesPlayed - gameWins` |
| `gameWinRatio` | `gameWins / gamesPlayed` |
| `roundsPlayed` | Sum of all rounds across those games |
| `roundWins` | Rounds where `roundWinnerUid === uid` |
| `roundLosses` | `roundsPlayed - roundWins` |
| `roundWinRatio` | `roundWins / roundsPlayed` |

Win rates are rendered as SVG circular progress gauges in `PlayerProfilePage` using `strokeDasharray` / `strokeDashoffset`.

---

## PWA & Deployment

The app is configured as an installable PWA via `vite-plugin-pwa`:

```
name:             Counga Score Keeper
short_name:       Counga
display:          standalone
orientation:      portrait
theme_color:      #1e1b4b
```

Workbox caches all JS, CSS, HTML, PNG, SVG, ICO, and WOFF2 assets. The service worker uses `registerType: 'autoUpdate'` — it silently updates in the background and activates on the next page load.

### Deployment

```bash
npm run deploy
# = tsc && vite build && gh-pages -d dist
```

Publishes the `dist/` folder to the `gh-pages` branch of the GitHub repository, making the app available at `https://famagusta74.github.io/Counga/`.

The Vite config sets `base: '/Counga/'` to match the GitHub Pages subdirectory, and injects `__APP_VERSION__` from `package.json` at build time.

---

## Environment Variables

Stored in `.env` (local) and GitHub Actions secrets (CI/CD). See `.env.example` for the full list.

| Variable | Usage |
|---|---|
| `VITE_FIREBASE_API_KEY` | Firebase project API key. **Also used as the Google Cloud Vision API key.** |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase Auth domain |
| `VITE_FIREBASE_PROJECT_ID` | Firestore project ID |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase Storage bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase Cloud Messaging sender ID |
| `VITE_FIREBASE_APP_ID` | Firebase app ID |

---

## Firestore Security Rules

Defined in `firestore.rules`:

| Collection | Read | Write |
|---|---|---|
| `users/{uid}` | Any authenticated user | Owner only |
| `users/{uid}/groupInvites/{groupId}` | Owner only | Any authenticated user (for sending invites) |
| `games/{gameId}` | Any authenticated user | Create: any auth; Update: creator or any game with players; Delete: creator only |
| `games/{gameId}/rounds/{roundId}` | Any authenticated user | Any authenticated user |
| `scanFeedback/{docId}` | Owner only | Any authenticated user (create) |
| `groups/{groupId}` | Any authenticated user | Create: Google accounts only; Update: owner or pending invitee; Delete: owner |

---

## Development & Build Scripts

```bash
npm run dev        # Start Vite dev server (HMR)
npm run build      # Type-check + production bundle
npm run preview    # Preview the production build locally
npm run deploy     # Build + push to GitHub Pages
```

Prerequisites: Node.js 18+. Firebase project must have:
- Authentication → Google provider enabled
- `https://famagusta74.github.io` in Authorized Domains
- Firestore database with the rules in `firestore.rules` deployed
- Google Cloud Vision API enabled in the same GCP project

---

## Changelog

### v1.11.0 — Shared Scorekeeper & Quality Fixes

**New features**

- **Real-time shared game view**: `GamePage` now uses Firestore `onSnapshot` listeners (`subscribeToGame`, `subscribeToRounds`) instead of one-shot fetches. All participants who open the game URL see scores update live in their browser the moment any player submits a round.
- **Share button**: A Share button on `GamePage` opens the native Web Share sheet on mobile or falls back to copying the game URL to the clipboard (with a "Copied!" toast). This is the primary way to let other players follow the game on their own phones.
- **Participant-scoped game lists**: Home dashboard and History now only show games the current user was part of (as creator or player), not all games in the database. `getRecentGames` queries by `createdBy` and by `playerUids array-contains`, merges and deduplicates the results.
- **`playerUids` field**: A flat string array is now written to every game document at creation and kept in sync when players are added mid-game, enabling the Firestore `array-contains` participant query.
- **Starting-score transparency**: The mid-game add-player form now shows a clear inline note: "Starts at X pts — same as [current leader]", so all players understand the fairness rule before confirming.

**Bug fixes**

- **`updateRound` now re-evaluates game status and winner**: Previously editing a past round only recomputed cumulative totals and eliminations; game `status` and `winner` could remain stale. The function now fully replays all rounds in `roundNumber` order and recalculates everything, including whether the game should be `finished`.
- **Camera stream leak fixed**: `CardPicker` no longer leaves the camera running when navigated away mid-scan. A `useEffect` cleanup hook using a `streamRef` stops all `MediaStream` tracks on unmount.
- **Scan feedback written once**: Previously `CardPicker` wrote an empty "pre-AI" feedback document immediately after capturing an image, and a second document at confirm time. Now a single feedback record is written at confirm with the final tokens, AI score, and any user correction.
- **All post-write `load()` calls removed from `GamePage`**: Because `onSnapshot` listeners keep state continuously current, the manual `await getGame` / `await getRounds` calls that followed each write were redundant and added latency. They have been removed.

