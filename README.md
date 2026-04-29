# Lumière 🎬

**Your personal local media library.** Drop a movie folder in, and Lumière turns it into a beautiful Netflix-style experience — posters, ratings, cast, subtitles and more. Zero account. Zero cloud. Everything stays on your device.

> **Primary target device: Samsung tablet running Android 13.**
> All UI, touch interactions, APK builds and testing are optimised for this platform.

---

## Features

| | |
|---|---|
| 🎨 **5 themes** | Spotlight (dark/red), Breeze (dark/blue), Horizon (warm amber), Forest (deep green), Violet (purple) |
| 🖼 **Auto metadata** | Fetches posters, backdrops, overview, cast & director from TMDB |
| ⭐ **Ratings** | IMDb score + Rotten Tomatoes via OMDB |
| 🏷 **Quality badges** | 4K · 1080p · HDR · Dolby Vision · Atmos — detected from filename |
| 🔞 **Age-rating filter** | Filter by G / PG / PG-13 / R / NC-17 (fetched automatically from TMDB) |
| 🎭 **Genre filter** | Browse by any genre in your library (auto-populated from movie data) |
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
| 📱 **Tablet & mobile ready** | Responsive layout for phones and tablets |

**Supported formats:** MP4, MKV, AVI, MOV, WebM, TS, M2TS, VOB, WMV, FLV, and more.

---

## Getting Started

### 1. Get free API keys (optional but recommended)

| Key | What it unlocks | Where to get it |
|-----|----------------|-----------------|
| TMDB | Posters, descriptions, cast, IMDb rating, age ratings | [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api) — free, ~30 seconds |
| OMDB | Rotten Tomatoes score | [omdbapi.com/apikey.aspx](https://www.omdbapi.com/apikey.aspx) — free tier available |

Lumière works without either key — movies will still play, just without artwork.

### 2. Install & run

```bash
# Clone
git clone https://github.com/arnebjerke1/media-player.git
cd media-player

# Install dependencies
npm install

# (Optional) configure API keys — they will be auto-filled in the setup wizard
cp .env.example .env
# Edit .env and add your TMDB_API_KEY and OMDB_API_KEY

# Start
npm start
```

Then open **http://localhost:3000** in your browser.

The first time you open it, the onboarding wizard will walk you through:
1. Choosing your theme
2. Adding your movies folder
3. Entering API keys *(pre-filled automatically if you set them in `.env`)*

---

## Android APK

Lumière can be installed as a native Android app — no Play Store required.

### Download

1. Go to the **[Actions tab](../../actions/workflows/build-apk.yml)** of this repository
2. Open the latest successful **Build Android APK** run
3. Download the **lumiere-player-debug** artifact
4. Unzip it — you'll find `app-debug.apk` inside

When a version tag (`v*`) is pushed, the APK is also attached directly to the **[Releases](../../releases)** page.

### Install on your Android device

1. Copy the downloaded `app-debug.apk` to your device (USB, email, cloud drive, etc.)
2. Open **Settings → Security** (or **Biometrics & Security**) on your device
   - Enable **Install unknown apps** for whatever app you'll open the APK with (e.g. *Files*, *Chrome*)
3. Tap the APK file in your file manager and choose **Install**
4. Launch **Lumière** from your home screen

### Preconfigure TMDB / OMDB in the Android app

If you want the APK to ship with metadata already enabled, set these environment variables before building:

```bash
export TMDB_API_KEY=your_tmdb_key
export OMDB_API_KEY=your_omdb_key
```

The Android build bakes them into the app, so posters and ratings are ready on first launch without manual entry.

> [!WARNING]
> Bundled API keys can be extracted from a shipped APK. Use dedicated low-privilege keys, and prefer runtime configuration if you want to avoid embedding keys in the app package.

### First use

1. Tap **Select Videos** on the setup screen
2. Use the file picker to select the video files you want to watch
3. *(Optional)* Enter your TMDB / OMDB API keys to get automatic posters and metadata
4. Tap **Done** — your library appears and you can start watching

> **Supported formats on Android:** MP4 · WebM · 3GP (natively). MKV/AVI/MOV playback depends on your device's codec support. MP4 (H.264) works on all Android devices.

---

## Using Lumière on a Samsung Tablet (Android 13)

> **This is the primary supported device.** Lumière is built and tested on a Samsung tablet running Android 13.

Lumière runs as a local web server — any device on the same Wi-Fi network can access it through a browser.

1. **Find your computer's local IP address**
   - Windows: open Command Prompt → `ipconfig` → look for `IPv4 Address` (e.g. `192.168.1.42`)
   - macOS/Linux: open Terminal → `ip addr` or `ifconfig` → look for `inet` under your Wi-Fi adapter

2. **Open the browser on your Samsung tablet** (Chrome, Samsung Internet, or Firefox)

3. **Type the address** in the URL bar:
   ```
   http://192.168.1.42:3000
   ```
   *(replace with your computer's actual IP and the port shown when you start the server)*

4. Both your computer and tablet must be on **the same Wi-Fi network**.

> **Tip:** You can bookmark the address on your tablet's home screen for quick access.

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
