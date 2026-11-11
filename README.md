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
Rush and 1v1 boards as the server (Node.js is needed for that one), that Swipe Rush runs
are verified, ranked and counted first-run-only as described below, and that accounts,
logins and the 1v1 matches (matchmaking, scoring, cheating attempts, ratings) behave.

## Deploy

For a step-by-step guide to hosting it for free on a small server with HTTPS, see
[DEPLOY.md](DEPLOY.md) (the files it uses are in `deploy/`). The rest of this section is the
general version.

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
you). It is required in practice: logins and 1v1 use secure connections (`https`, `wss`),
and Google sign-in refuses plain http outside localhost. Pick a host that supports
WebSockets and a persistent disk, and run a single instance.

Settings (environment variables):

| Variable | What it does |
| --- | --- |
| `SCORES_DB` | Path of the SQLite file with accounts, scores and matches. Put it on a persistent disk and **back it up**: it holds everyone's accounts. |
| `GOOGLE_CLIENT_ID` | Turns on "Sign in with Google" (see Accounts). |
| `CONTACT_EMAIL` | The address shown on the privacy and terms pages. |
| `ALLOWED_ORIGINS` | Only when the frontend is hosted on a different address than the server. |

**Checklist before going public:** HTTPS on, `SCORES_DB` on a persistent disk with backups,
one server process, `CONTACT_EMAIL` set, `GOOGLE_CLIENT_ID` set if you want Google, and the
privacy policy and terms read over (you store emails).

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

## Accounts

- **Log in / sign up** is the button at the top right of the menu. A player can sign up with
  email, username and password, or with Google. Usernames are 3-16 letters, numbers, spaces,
  `_` or `-`, and are unique ignoring case. Passwords need 8+ characters.
- Everything lives in the same SQLite file as the scores (`SCORES_DB`): the `users` table
  (id, email, username, password hash or Google id, rating and win/loss record), `sessions`
  and `matches`. Passwords are hashed with scrypt; login tokens are random and only their
  SHA-256 is stored. The browser keeps the token in `localStorage` and sends it as
  `Authorization: Bearer ...`. A session lasts 30 days; logging out ends it on the server.
- The server takes the player's identity from the token only. A request can no longer
  say whose score it is.
- Sign-ups and login attempts are rate limited per address (in memory, per server process).
- **Google sign-in** is off until you set `GOOGLE_CLIENT_ID` (an OAuth *Web* client id from
  the Google Cloud console, with your site's address under "Authorised JavaScript origins").
  A first-time Google player picks a username. If someone had already registered that email
  with a password, a verified Google login takes the account over and the old password stops
  working (there is no email verification yet, so anyone could have registered an email
  that is not theirs).
- The account button in the menu lets a player **change their username** (their old scores
  follow) or **delete their account** (it removes the account, logins and leaderboard times;
  they type their username and password to confirm).
- Usernames pass a small word filter (`BLOCKED_PARTS` in `backend/accounts.py`) that also catches
  look-alikes such as `sh1t`, and blocks names that look like staff (`admin`...). Add words to
  it as players report names.
- `frontend/public/privacy.html` and `terms.html` are linked from the menu and the sign-up
  form. They show the address in `CONTACT_EMAIL`. Have them read over before you launch: they
  describe what the game actually stores today, so update them if that changes.
- **Not built yet:** password reset and email verification. Both need an email service (for
  example Resend, Postmark or any SMTP server) and an account with it. Until then a player who
  forgets their password cannot recover that account (Google sign-in does not have the problem).

## 1v1 Swipe Rush

- **1 V 1 RUSH** on the menu (login needed). **Find an opponent** pairs you with the next player
  searching and is *ranked*; **Play a friend** makes a 5-letter code to send, and the friend
  enters it under "Have a code?". Friendly matches never change ratings.
- Both players fall into the cave together, get a 3-2-1, and race for five minutes on the **same
  boards**. Whoever clears more wins; on a tie, whoever cleared their last board sooner; nothing
  cleared by either is a draw. Every match uses a fresh random seed, so unlike the daily
  boards every match plays on new maps (same difficulty curve as Swipe Rush, `RUSH_TIERS`).
- Ranked matches move an Elo rating (start 1000, K=32). The leaderboard's **1v1** tab ranks by
  rating, and shows wins and losses.
- How it is kept honest (`backend/versus.py`): the server picks the seed, keeps the clock and the
  score, and only counts a board when the player sends a route that clears *that* board, in
  order, replayed on the server's own copy (the browser builds boards from the seed so play is
  instant, `generateMatchBoard` in `generator.js`, kept identical by the parity test). It also
  refuses boards cleared faster than a person could.
- The connection is one WebSocket (`/api/versus/ws`). If it drops mid-match the browser
  reconnects and the server puts the player back in the match. Leaving the match counts as losing
  it: the clock does not stop.
- `MATCH_SECONDS` and `MATCH_COUNTDOWN_SECONDS` change the length and the countdown (the
  timer on screen assumes five minutes, so only change them for testing).
- Matchmaking and running matches live in memory, so **run one server process** (no
  `--workers`). That is plenty for a small launch; supporting several would mean moving the
  queue and matches into Redis or similar.

## Global leaderboard

- Runs are posted under the player's **account** (see Accounts below). Playing needs no
  login, but after a first run a guest sees "Log in or sign up" instead of a name box. The
  run is kept in the browser and sent the moment they log in, together with any other
  first run cleared earlier as a guest.
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
- Before launch, consider adding a word filter for usernames.

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
