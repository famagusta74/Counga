# Counga Score Keeper

A mobile-first Progressive Web App (PWA) for tracking scores in the **Counga** card game — playable directly from GitHub Pages on any device.

## 🃏 Card Point Values

| Card | Points |
|------|--------|
| A | 11 |
| 2–10 | Face value |
| J, Q, K | 10 |
| Joker | 25 |

## 🎮 How to Play

1. Start a new game and set the **target score** (game ends when any player reaches it)
2. Add players — guests play instantly, or sign in with Google to keep history
3. After each round, use the **camera** to photograph each player's remaining cards and assign scores
4. Rankings are **lowest score first** — the player with the fewest points wins
5. When the game ends, the winner is recorded in game history

## 🚀 Getting Started

### Prerequisites
- Node.js 18+

> Firebase is already configured — it uses the existing `football-prediction-game-ca155` project.
> Make sure `https://famagusta74.github.io` is in the **Authorized domains** in Firebase → Authentication → Settings.

### 1. Clone & Install

```bash
git clone https://github.com/famagusta74/Counga.git
cd Counga
npm install
```

### 2. Run Locally

```bash
npm run dev
```

### 3. Deploy to GitHub Pages

```bash
npm run deploy
```

Then visit: `https://famagusta74.github.io/Counga/`

## 📱 Install as Mobile App

Visit the GitHub Pages URL on your phone and use **"Add to Home Screen"** — it works as a native-feeling app thanks to PWA support.

## 🗂 Project Structure

```
src/
├── components/     # Reusable UI components
├── contexts/       # React contexts (Auth, Game)
├── firebase/       # Firebase config & helpers
├── hooks/          # Custom hooks
├── pages/          # Route pages
├── types/          # TypeScript types
└── utils/          # Card scoring logic
```
