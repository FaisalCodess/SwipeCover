# Swipe Cover

Swipe Cover is a daily sliding puzzle. Three new boards every day, the same for
every player. The ball slides until a wall or the edge stops it; cover every dot
to clear the level.

- **Frontend:** React, Vite, Tailwind CSS. Moves run locally, so play is instant.
- **Backend:** Python FastAPI. Generates the daily boards and can host the built frontend.

## Requirements

- Python 3.10 or newer
- Node.js 18 or newer and npm

## Develop

Start the game server (PowerShell, from the repository root):

```powershell
cd backend
python -m pip install -r requirements.txt
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

In another terminal, start the frontend:

```powershell
cd frontend
npm install
npm run dev
```

Open <http://127.0.0.1:5173/>. Vite forwards `/api` requests to the Python
server; set `GAME_API_PROXY` to point it somewhere other than
`http://127.0.0.1:8000`.

## Test

```powershell
cd backend
python -m pip install -r requirements-dev.txt
python -m pytest
```

The tests check that 40 days of generated boards are all solvable, follow each
level's difficulty rules, and that the API behaves.

## Deploy

The simplest setup is one service: build the frontend, and the Python server
hosts it alongside the API.

```powershell
cd frontend
npm ci
npm run build
cd ../backend
python -m pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --proxy-headers
```

Put it behind HTTPS (most hosts such as Render, Railway or Fly.io do this for
you).

The global leaderboard is stored in a SQLite file (`backend/scores.db` by
default). Many hosts wipe the app's own folder on every deploy, so attach a
persistent disk and point `SCORES_DB` at it, for example
`SCORES_DB=/data/scores.db`, or the leaderboard resets with each release. If you host the frontend separately instead (for example on Netlify or
Vercel), build it with `VITE_GAME_API_URL=https://your-api.example.com/api`
and start the server with `ALLOWED_ORIGINS=https://your-site.example.com`.

## How the puzzles work

- Each board is built around a random solution walk, so it is always solvable,
  then double-checked with an exact solver (`analyze` in `backend/game.py`).
- Difficulty comes from one-way moves: level 1 can never trap you, level 2 has
  a couple of points of no return, level 3 has several.
- Boards are seeded by the date in Jordan time (UTC+3) and level, so everyone
  gets the same three puzzles, and they reset at midnight.

## Global leaderboard

- After clearing a level, players choose a name (3-16 letters, numbers, spaces,
  `_` or `-`) and every finished level is submitted from then on.
- The server replays each submitted route on that day's board and rejects runs
  that do not solve it or are impossibly fast, so only real solves are ranked.
- Each player keeps their fastest time per level per day; the menu shows the
  top 10 and the player's own place.
- Offline, the leaderboard shows the device's own times and unsent runs are
  retried on the next visit.
- Before launch, consider adding a word filter for player names.

## Background music

The music is a local file, not a stream. Put your track at
`frontend/public/music/background.mp3` (use only music you have the rights to). If you
use another format or name, update `MUSIC_URL` in `frontend/src/BackgroundMusic.jsx`.
If the file is missing or cannot play, the game falls back to a built-in synth melody.

## Controls

Swipe on the board, use the on-screen pad, or the keyboard:
WASD / arrow keys to move, Z to undo, R to restart, Esc to pause.
Settings and leaderboard times are stored in the browser.
