# Swipe Cover

Swipe Cover is a daily sliding puzzle. Three new boards every day, the same for
every player. The ball slides until a wall or the edge stops it; cover every dot
to clear the level. **Swipe Rush** is the fast mode: five minutes, as many small
boards as you can clear, played in a cave below the menu.

- **Frontend:** React, Vite, Tailwind CSS. Moves run locally, so play is instant.
- **Backend:** Python FastAPI. Generates the daily boards and can host the built frontend.

## Requirements

- Python 3.10 or newer
- Node.js 18 or newer and npm

## Run with Docker

```bash
docker compose up --build
```

Open <http://localhost:8000/>. The first run builds the image; after that
`docker compose up` is enough (add `--build` again after changing code). The
leaderboard is kept in the `scores` Docker volume, so it survives restarts.

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
level's difficulty rules, and that the API behaves. They also check that the browser's
board generator (`frontend/src/generator.js`) builds exactly the same daily and Swipe
Rush boards as the server (Node.js is needed for that one), and that Swipe Rush runs
are verified, ranked and counted first-run-only as described below.

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

## Daily levels

- On the menu each level is an orb: red until you clear it, grey once cleared.
  Levels open in order, so level 2 needs level 1 cleared, and level 3 needs
  level 2. Pressing a level that is not open yet is turned away with a message
  and points you at the level to play first.
- A cleared level never locks. Press its grey orb to play it again, or use
  PLAY AGAIN once all three are cleared. Replays are marked PRACTICE and are
  just for fun: they are not saved and are never sent to the leaderboard.
- Your first run of a level is timed from the moment you first start it until you
  solve it, and **the clock never stops**. Pausing, restarting, going back to the
  menu, switching windows or even closing the page does not pause or reset it.
  Coming back to the level picks the board up where you left it, with the clock
  still counting, so a run cannot be "re-rolled" once you have seen the solution.

## Swipe Rush

- **SWIPE RUSH** on the menu: the camera falls out of the menu, through the earth
  and into a cave, and a five minute countdown starts. Clear a board and the next
  appears at once; the score is how many boards you clear before time runs out.
- Everyone gets the same endless sequence each day, in the same order, and it
  resets at midnight (Jordan time) like the daily levels. Boards start tiny
  (3-4 moves) and get bigger and trickier as the run goes on.
- Undo (Z) and restart (R) work and cost time like everything else. There is **no
  pause**: the clock cannot stop. In the last minute the cave heats up, and the last
  ten seconds tick.
- Like a daily level, only your **first** Swipe Rush of the day counts. Its deadline
  is written down when it starts, so leaving for the menu, reloading or closing the
  page does not stop or reset it. The menu shows `RESUME` and the time left, and
  coming back picks the board up where you left it. If the time runs out while you
  are away, the run is closed with the boards cleared so far. After that, SWIPE RUSH
  starts a replay (marked PRACTICE) that is not saved or sent.
- Music gets more intense in the cave: the track plays faster with its pitch rising
  with the speed, a little louder, with a low pulse under it that tightens as time
  runs out. All of it is live processing in the browser (the mp3 itself is never
  changed) and it eases back to normal when you leave. The knobs are
  `RATE_BY_INTENSITY` and `RUSH_VOLUME_BOOST` in `frontend/src/BackgroundMusic.jsx`,
  and `PULSE_BPM` and `PULSE_LEVEL` in `frontend/src/rushAudio.js`.
- **Difficulty** is one table, `RUSH_TIERS` in `backend/game.py`, mirrored in
  `frontend/src/generator.js`. Each tier gives a board size and `steps`, the length
  of the solution walk a board is built around, so a board's shortest solution is
  about that many moves. Board N of a day is a pure function of the date and N, so
  the server can rebuild exactly the boards a player saw. Change a tier in both files
  and keep the parity test green.

## Global leaderboard

- After clearing a level, players choose a name (3-16 letters, numbers, spaces,
  `_` or `-`) and their first run of every level is submitted from then on. A
  first run cleared before choosing a name is sent as soon as they join.
- Only the **first** run of each level each day counts. Replays are ignored, by
  the game and by the server, however fast they are. The same goes for Swipe Rush.
- Swipe Rush has its own tab. It is ranked by boards cleared, then by who cleared
  the last one sooner. The server replays every submitted board route, in order from
  board 1 with none skipped, on that day's board of the same number.
- The server replays each submitted route on that day's board and rejects runs
  that do not solve it or are impossibly fast, so only real solves are ranked.
- The menu shows the top 10 and the player's own place.
- Offline, the leaderboard shows the device's own times and unsent runs are
  retried on the next visit.
- The clocks (levels and Swipe Rush) run in the browser, so this stops casual
  re-rolls, not a determined cheater (who can clear site data or call the API
  directly, and could compute solutions for the public boards). Closing that gap
  needs the server to timestamp when each level or run is started.
- Before launch, consider adding a word filter for player names.

## Background music

The music is a local file, not a stream. Put your track at
`frontend/public/music/background.mp3` (use only music you have the rights to). If you
use another format or name, update `MUSIC_URL` in `frontend/src/BackgroundMusic.jsx`.
If the file is missing or cannot play, the game falls back to a built-in synth melody.

## Controls

Swipe on the board, use the on-screen pad, or the keyboard:
WASD / arrow keys to move, Z to undo, R to restart, Esc to pause (levels only).
A swipe can turn without lifting the finger (right, then down, ...) to chain moves in one stroke.
Pausing only covers the board; the clock keeps running. Swipe Rush cannot be paused.
Settings and leaderboard times are stored in the browser.

## The ball

The ball's motion runs outside React, in `frontend/src/ballEngine.js`: a frame loop slides it
along one timing curve, squashes and stretches it on springs (so it wobbles when it hits a wall)
and draws sparks, a comet tail and its glow on a canvas over the board. The tiles light up on the
same curve (`paintDelay` in `frontend/src/motion.js`), so change the curve there and both follow.
Spring stiffness, stretch amounts and spark counts are plain numbers in `ballEngine.js`. With
"reduce motion" turned on in the system settings, the ball moves instantly and no sparks are drawn.
