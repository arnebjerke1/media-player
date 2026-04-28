# Lumière 🎬

**Your personal local media library.** Drop a movie folder in, and Lumière turns it into a beautiful Netflix-style experience — posters, ratings, cast, subtitles and more. Zero account. Zero cloud. Everything stays on your device.

---

## Features

| | |
|---|---|
| 🎨 **3 themes** | Spotlight (dark/red), Breeze (dark/blue), Horizon (warm amber) |
| 🖼 **Auto metadata** | Fetches posters, backdrops, overview, cast & director from TMDB |
| ⭐ **Ratings** | IMDb score + Rotten Tomatoes via OMDB |
| 🏷 **Quality badges** | 4K · 1080p · HDR · Dolby Vision · Atmos — detected from filename |
| 🎲 **Surprise Me** | Pick by mood, time available, rating & genre — finds a random unwatched film |
| ❤️ **Favourites & Watchlist** | Personal curation, stored locally |
| 👁 **Unwatched filter** | One tap to see only films you haven't started |
| 📊 **Movie DNA** | Genre breakdown + hours watched in Settings |
| ▶️ **Resume watching** | Picks up exactly where you left off |
| 📝 **Subtitles** | Auto-detects `.srt`/`.vtt`/`.ass` alongside video files |
| 💤 **Sleep timer** | Auto-pause after 30 / 60 / 90 / 120 min |
| ⧉ **Picture-in-Picture** | Watch while doing something else |
| 🔒 **Media Session** | Lock-screen / OS transport controls |
| ⌨️ **Keyboard shortcuts** | Space, ←/→, ↑/↓, M, F, C |
| 📱 **Touch gestures** | Double-tap left/right to skip ±10 s |

**Supported formats:** MP4, MKV, AVI, MOV, WebM, TS, M2TS, VOB, WMV, FLV, and more.

---

## Getting Started

### 1. Get free API keys (optional but recommended)

| Key | What it unlocks | Where to get it |
|-----|----------------|-----------------|
| TMDB | Posters, descriptions, cast, IMDb rating | [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api) — free, ~30 seconds |
| OMDB | Rotten Tomatoes score | [omdbapi.com/apikey.aspx](https://www.omdbapi.com/apikey.aspx) — free tier available |

Lumière works without either key — movies will still play, just without artwork.

### 2. Install & run

```bash
# Clone
git clone https://github.com/arnebjerke1/media-player.git
cd media-player

# Install dependencies
npm install

# (Optional) configure API keys
cp .env.example .env
# Edit .env and add your TMDB_API_KEY and OMDB_API_KEY

# Start
npm start
```

Then open **http://localhost:3000** in your browser.

The first time you open it, the onboarding wizard will walk you through:
1. Choosing your theme
2. Adding your movies folder
3. Entering API keys

---

## Keyboard Shortcuts (Player)

| Key | Action |
|-----|--------|
| `Space` / `K` | Play / Pause |
| `←` / `→` | Skip back / forward 10 s |
| `↑` / `↓` | Volume up / down |
| `M` | Toggle mute |
| `F` | Toggle fullscreen |
| `C` | Cycle subtitle tracks |
| Scroll wheel | Volume |

---

## How filename parsing works

Lumière automatically cleans up torrent-style filenames:

| Filename | Detected title | Year |
|----------|---------------|------|
| `a.cat.named.bob.1080p.x265.mkv` | A Cat Named Bob | — |
| `The.Dark.Knight.2008.BluRay.mkv` | The Dark Knight | 2008 |
| `Interstellar (2014) 4K HDR.mp4` | Interstellar | 2014 |

---

## Tech stack

- **Backend:** Node.js · Express · SQLite (better-sqlite3) · TMDB API · OMDB API
- **Frontend:** Vanilla JS · CSS custom properties (no framework, stays fast and light)
- **Player:** Native HTML5 `<video>` with range-based streaming, WebVTT subtitles, Media Session API, PiP API

---

*Named after Auguste and Louis Lumière — the brothers who held the first public cinema screening in 1895.*
