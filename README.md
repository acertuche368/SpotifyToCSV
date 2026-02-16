# SpotifyToCSV React + Python

This project gives you:

- A React CSV/Excel-style editor with columns:
  - `URL`
  - `Artist`
  - `Track Name`
  - `Genre`
  - `Album`
  - `Release Date`
  - `Duration`
  - `Explicit`
  - `Popularity`
- Paste support for newline-separated Spotify track URLs
- CSV/XLSX import and XLSX export
- A Python backend that fills metadata (no API keys required):
  - `Artist`, `Track Name`, `Genre`, `Album`, `Release Date`, `Duration`, `Explicit`, `Popularity`

## 1) Install dependencies

### Frontend

```bash
npm install
```

### Backend (Python)

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
```

## 2) Run the app

In terminal 1 (backend):

```bash
source .venv/bin/activate
uvicorn backend.app:app --reload --port 8000
```

In terminal 2 (frontend):

```bash
npm run dev
```

Open `http://localhost:5173`.

## 3) Use it

1. Paste Spotify URLs (one per line) and click `Load URLs Into Table`.
2. Click `Fill Metadata` to fetch metadata from Python backend.
3. Edit any cell manually if needed.
4. Click `Export XLSX` to download `spotify_tracks.xlsx`.

## 4) Command-line XLSX mode (your original flow)

Your script was adapted and kept as a CLI command:

```bash
python -m backend.fill_spotify_track_artist input.xlsx output.xlsx
```

Defaults expected by the script:

- Sheet: `Tracks`
- URL column: `Spotify URL` (also accepts `URL` as fallback)

It outputs a new workbook with all existing columns preserved plus:

- `Track Name`
- `Artist`
- `Genre`
- `Album`
- `Release Date`
- `Duration`
- `Explicit`
- `Popularity`

## Notes

- This uses Spotify public web endpoints (with fallback HTML scraping) and may require tweaks if Spotify changes their web format.
- A small request delay is included to reduce rate limiting.
