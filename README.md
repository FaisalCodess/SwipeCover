# Swipe Cover

Swipe Cover is a responsive daily puzzle game with a React, Vite, and Tailwind
CSS frontend and a Python FastAPI game engine.

## Requirements

- Python 3.10 or newer
- Node.js and npm

## Run the Python game server

From the repository root, run these commands in PowerShell:

```powershell
cd backend
python -m pip install -r requirements.txt
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

## Run the frontend

Open another PowerShell terminal from the repository root:

```powershell
cd frontend
npm install
npm run dev
```

Open the local URL printed by Vite (normally <http://127.0.0.1:5173/>).
The frontend connects to the Python API at <http://127.0.0.1:8000/api>.
Set `VITE_GAME_API_URL` before starting Vite to use a different API URL.

## Gameplay

Use WASD or the arrow keys, the on-screen direction pad, or swipe on the board.
The player slides until a wall or board edge stops them. Cover every dot to
complete a level. Settings and daily best times are saved in browser storage.
