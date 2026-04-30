'use strict';

require('dotenv').config();

const express = require('express');
const os      = require('os');
const path    = require('path');
const fs      = require('fs');
const { execSync, spawn } = require('child_process');

const db                        = require('./src/db');
const { scanDirectory, findSubtitles } = require('./src/scanner');
const { fetchMetadata, fetchTvMetadata, fetchSeasonPoster } = require('./src/metadata');
const { parseFilename, parseTvFilename, detectQuality }  = require('./src/parser');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Boot ───────────────────────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
db.init();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── FFmpeg availability ────────────────────────────────────────────────────────
let ffmpegAvailable = false;
try {
  execSync('ffmpeg -version', { stdio: 'pipe' });
  ffmpegAvailable = true;
  console.log('[ffmpeg] Transcoding available');
} catch {
  console.log('[ffmpeg] Not found – transcoding disabled');
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function parseMedia(item) {
  if (!item) return item;
  return {
    ...item,
    genres:    item.genres    ? JSON.parse(item.genres)    : [],
    cast:      item.cast      ? JSON.parse(item.cast)      : [],
    subtitles: item.subtitles ? JSON.parse(item.subtitles) : [],
    media_type: item.media_type || 'movie',
  };
}

// ── Config API ─────────────────────────────────────────────────────────────────
app.get('/api/config', (_req, res) => {
  res.json(db.getConfig());
});

app.post('/api/config', (req, res) => {
  const { theme, mediaFolders, tmdbApiKey, omdbApiKey, setupComplete } = req.body;
  db.saveConfig({ theme, mediaFolders, tmdbApiKey, omdbApiKey, setupComplete });
  res.json({ success: true });
});

// ── Capabilities API ───────────────────────────────────────────────────────────
app.get('/api/capabilities', (_req, res) => {
  res.json({ ffmpegAvailable });
});

// ── Media API ──────────────────────────────────────────────────────────────────
app.get('/api/media', (_req, res) => {
  res.json(db.getAllMedia().map(parseMedia));
});

app.get('/api/media/:id', (req, res) => {
  const item = parseMedia(db.getMediaById(parseInt(req.params.id, 10)));
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});

app.delete('/api/media/:id', (req, res) => {
  const deleteFile = req.query.deleteFile === 'true';
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });

  const item = db.getMediaById(id);
  if (!item) return res.status(404).json({ error: 'Not found' });

  if (deleteFile) {
    // Resolve and validate the path to prevent directory traversal
    const resolved = item.path ? path.resolve(item.path) : null;
    if (resolved && !resolved.startsWith(path.sep) && !resolved.match(/^[A-Za-z]:\\/)) {
      return res.status(400).json({ error: 'Invalid file path' });
    }
    if (resolved && fs.existsSync(resolved)) {
      try {
        fs.unlinkSync(resolved);
      } catch (err) {
        return res.status(500).json({ error: `Could not delete file: ${err.message}` });
      }
    }
  }

  db.deleteMedia(id);
  res.json({ success: true });
});

app.post('/api/media/:id/refresh', async (req, res) => {
  const item = db.getMediaById(parseInt(req.params.id, 10));
  if (!item) return res.status(404).json({ error: 'Not found' });

  const config = db.getConfig();
  if (!config.tmdbApiKey) return res.status(400).json({ error: 'No TMDB API key configured' });

  const parsed = parseFilename(item.filename);
  const meta   = await fetchMetadata(parsed.title, parsed.year, config.tmdbApiKey, config.omdbApiKey);
  if (!meta) return res.status(404).json({ error: 'No metadata found for this title' });

  db.updateMedia(item.id, {
    title:        meta.title,
    year:         meta.year,
    tmdbId:       meta.tmdbId,
    imdbId:       meta.imdbId,
    overview:     meta.overview,
    tagline:      meta.tagline,
    posterPath:   meta.posterPath,
    backdropPath: meta.backdropPath,
    genres:       meta.genres    ? JSON.stringify(meta.genres)    : null,
    rating:       meta.rating,
    rtScore:      meta.rtScore,
    runtime:      meta.runtime,
    language:     meta.language,
    cast:         meta.cast      ? JSON.stringify(meta.cast)      : null,
    director:     meta.director,
    certification: meta.certification || null,
  });

  res.json(parseMedia(db.getMediaById(item.id)));
});

// ── Directory Browser API ──────────────────────────────────────────────────────
const BROWSE_SKIP = new Set([
  'node_modules', 'System Volume Information', '$RECYCLE.BIN',
  'Windows', 'Program Files', 'Program Files (x86)',
  'proc', 'sys', 'dev', 'run',
]);

/** Common media folder suggestions by platform. */
function getMediaSuggestions() {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (process.platform === 'win32') {
    return [
      path.join(process.env.USERPROFILE || 'C:\\Users\\User', 'Videos'),
      path.join(process.env.USERPROFILE || 'C:\\Users\\User', 'Movies'),
      'D:\\Movies', 'D:\\Videos', 'E:\\Movies',
    ].filter(p => fs.existsSync(p));
  }
  // Android / Linux / macOS
  const candidates = [
    '/sdcard/Movies', '/sdcard/Videos', '/sdcard/TV Shows',
    '/storage/emulated/0/Movies', '/storage/emulated/0/Videos',
    '/storage/emulated/0/TV Shows',
    path.join(home, 'Movies'), path.join(home, 'Videos'),
    path.join(home, 'TV Shows'), '/media', '/mnt',
  ];
  return candidates.filter(p => {
    try { return fs.statSync(p).isDirectory(); } catch (err) {
      if (err.code !== 'ENOENT' && err.code !== 'EACCES') {
        console.warn('[browse] Unexpected error checking suggestion', p, err.message);
      }
      return false;
    }
  });
}

// Prefixes that should never be browsed (sensitive system directories)
const BLOCKED_PATH_PREFIXES = process.platform === 'win32' ? [] : [
  '/etc', '/boot', '/bin', '/sbin', '/lib', '/lib64',
  '/usr/bin', '/usr/sbin', '/usr/lib',
];

app.get('/api/browse', (req, res) => {
  const requestedPath = req.query.path;

  // No path supplied → start from home directory so the browser is immediately navigable
  if (!requestedPath) {
    const suggestions = getMediaSuggestions();
    const defaultPath = os.homedir();

    if (!fs.existsSync(defaultPath)) {
      return res.json({ current: null, parent: null, entries: [], suggestions });
    }

    let rawEntries;
    try {
      rawEntries = fs.readdirSync(defaultPath, { withFileTypes: true });
    } catch (_err) {
      return res.json({ current: null, parent: null, entries: [], suggestions });
    }

    const entries = rawEntries
      .filter(e => e.isDirectory() && !e.name.startsWith('.') && !BROWSE_SKIP.has(e.name))
      .map(e => ({ name: e.name, path: path.join(defaultPath, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const parentPath = path.dirname(defaultPath);
    const parent     = parentPath !== defaultPath ? parentPath : null;

    return res.json({ current: defaultPath, parent, entries, suggestions });
  }

  const resolved = path.resolve(requestedPath);

  // Block access to sensitive system directories
  for (const prefix of BLOCKED_PATH_PREFIXES) {
    if (resolved === prefix || resolved.startsWith(prefix + '/') || resolved.startsWith(prefix + path.sep)) {
      return res.status(403).json({ error: 'Access to this directory is not permitted' });
    }
  }

  if (!fs.existsSync(resolved)) {
    return res.status(404).json({ error: 'Directory not found' });
  }

  let stat;
  try { stat = fs.statSync(resolved); } catch (err) {
    return res.status(403).json({ error: err.message });
  }
  if (!stat.isDirectory()) {
    return res.status(400).json({ error: 'Not a directory' });
  }

  let rawEntries;
  try {
    rawEntries = fs.readdirSync(resolved, { withFileTypes: true });
  } catch (err) {
    return res.status(403).json({ error: `Cannot read directory: ${err.message}` });
  }

  const entries = rawEntries
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && !BROWSE_SKIP.has(e.name))
    .map(e => ({ name: e.name, path: path.join(resolved, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const parentPath = path.dirname(resolved);
  const parent     = parentPath !== resolved ? parentPath : null;

  res.json({ current: resolved, parent, entries, suggestions: [] });
});

// ── Scan API ───────────────────────────────────────────────────────────────────
let scanState = { inProgress: false, total: 0, processed: 0, current: '', errors: [] };

/** Core scan logic — shared by HTTP endpoint and startup auto-scan. */
async function runScan() {
  const config = db.getConfig();
  if (!config.mediaFolders?.length) return;

  scanState = { inProgress: true, total: 0, processed: 0, current: '', errors: [] };

  try {
    const files = config.mediaFolders.flatMap(f => scanDirectory(f));
    scanState.total = files.length;

    // Cache TV show metadata so we only fetch once per show
    const tvMetaCache = {};
    // Cache TV season posters per show+season
    const tvSeasonPosterCache = {};

    for (const filePath of files) {
      scanState.current = path.basename(filePath);

      const existingRef = db.getMediaByPath(filePath);
      if (existingRef) {
        // Already indexed — re-classify as TV if filename now matches, and/or re-fetch metadata
        const existingItem = db.getMediaById(existingRef.id);
        if (existingItem) {
          // Re-classify: if item was stored as movie but filename is actually a TV episode, fix it
          const reParsedTv = parseTvFilename(existingItem.filename, existingItem.path);
          if (reParsedTv && existingItem.media_type !== 'tv') {
            db.updateMedia(existingItem.id, {
              mediaType: 'tv',
              showName:  reParsedTv.showName,
              season:    reParsedTv.season,
              episode:   reParsedTv.episode,
              title:     `${reParsedTv.showName} S${String(reParsedTv.season).padStart(2,'0')}E${String(reParsedTv.episode).padStart(2,'0')}`,
            });
            // Reload so subsequent metadata fetch uses correct type/show
            Object.assign(existingItem, {
              media_type: 'tv',
              show_name:  reParsedTv.showName,
              season:     reParsedTv.season,
              episode:    reParsedTv.episode,
            });
          }

          // Re-fetch metadata if missing poster:
          //   TV shows → always (TVMaze is free, no key needed)
          //   Movies   → only when a TMDB API key is configured
          const isTv = existingItem.media_type === 'tv' && existingItem.show_name;
          const canFetch = !existingItem.poster_path && (isTv || config.tmdbApiKey);
          if (canFetch) {
            try {
              let updatedMeta = null;
              if (isTv) {
                if (!tvMetaCache[existingItem.show_name]) {
                  tvMetaCache[existingItem.show_name] = await fetchTvMetadata(existingItem.show_name, config.tmdbApiKey, config.omdbApiKey);
                }
                updatedMeta = tvMetaCache[existingItem.show_name];

                // Fetch season poster via TVMaze
                if (updatedMeta?.tvMazeId && existingItem.season != null) {
                  const spKey = `${updatedMeta.tvMazeId}_${existingItem.season}`;
                  if (!tvSeasonPosterCache[spKey]) {
                    tvSeasonPosterCache[spKey] = await fetchSeasonPoster(updatedMeta.tvMazeId, existingItem.season);
                  }
                  updatedMeta = { ...updatedMeta, seasonPosterPath: tvSeasonPosterCache[spKey] };
                }
              } else {
                const parsed = parseFilename(existingItem.filename);
                updatedMeta = await fetchMetadata(parsed.title, parsed.year, config.tmdbApiKey, config.omdbApiKey);
              }
              if (updatedMeta) {
                db.updateMedia(existingItem.id, {
                  title:            updatedMeta.title,
                  year:             updatedMeta.year,
                  tmdbId:           updatedMeta.tmdbId,
                  tvMazeId:         updatedMeta.tvMazeId,
                  imdbId:           updatedMeta.imdbId,
                  overview:         updatedMeta.overview,
                  tagline:          updatedMeta.tagline,
                  posterPath:       updatedMeta.posterPath,
                  backdropPath:     updatedMeta.backdropPath,
                  seasonPosterPath: updatedMeta.seasonPosterPath || null,
                  genres:           updatedMeta.genres ? JSON.stringify(updatedMeta.genres) : null,
                  rating:           updatedMeta.rating,
                  rtScore:          updatedMeta.rtScore,
                  runtime:          updatedMeta.runtime,
                  language:         updatedMeta.language,
                  cast:             updatedMeta.cast ? JSON.stringify(updatedMeta.cast) : null,
                  director:         updatedMeta.director,
                  certification:    updatedMeta.certification || null,
                });
              }
            } catch (err) {
              console.error('[scan] metadata re-fetch error:', err.message);
            }
          }
        }
        scanState.processed++;
        continue;
      }

      const filename = path.basename(filePath);
      const tvParsed = parseTvFilename(filename, filePath);
      const quality  = detectQuality(filename);
      const subs     = findSubtitles(filePath);

      let meta             = null;
      let mediaType        = 'movie';
      let showName         = null;
      let season           = null;
      let episode          = null;
      let seasonPosterPath = null;

      if (tvParsed) {
        // TV show episode — TVMaze is free, fetch metadata without any API key
        mediaType = 'tv';
        showName  = tvParsed.showName;
        season    = tvParsed.season;
        episode   = tvParsed.episode;

        if (!tvMetaCache[showName]) {
          tvMetaCache[showName] = await fetchTvMetadata(showName, config.tmdbApiKey, config.omdbApiKey);
        }
        meta = tvMetaCache[showName];

        // Fetch season-specific poster via TVMaze
        if (meta?.tvMazeId && season != null) {
          const spKey = `${meta.tvMazeId}_${season}`;
          if (!tvSeasonPosterCache[spKey]) {
            tvSeasonPosterCache[spKey] = await fetchSeasonPoster(meta.tvMazeId, season);
          }
          seasonPosterPath = tvSeasonPosterCache[spKey];
        }
      } else {
        // Regular movie
        const parsed = parseFilename(filename);
        if (config.tmdbApiKey) {
          meta = await fetchMetadata(parsed.title, parsed.year, config.tmdbApiKey, config.omdbApiKey);
        }
        if (!meta) {
          meta = { title: parsed.title, year: parsed.year };
        }
      }

      db.saveMedia({
        path:              filePath,
        filename,
        mediaType,
        showName:          showName  || null,
        season:            season    || null,
        episode:           episode   || null,
        title:             tvParsed
                             ? (meta?.title ? `${meta.title} S${String(season).padStart(2,'0')}E${String(episode).padStart(2,'0')}` : filename)
                             : (meta?.title || parseFilename(filename).title),
        year:              meta?.year         || null,
        tmdbId:            meta?.tmdbId       || null,
        tvmazeId:          meta?.tvMazeId     || null,
        imdbId:            meta?.imdbId       || null,
        overview:          meta?.overview     || null,
        tagline:           meta?.tagline      || null,
        posterPath:        meta?.posterPath   || null,
        backdropPath:      meta?.backdropPath || null,
        seasonPosterPath:  seasonPosterPath   || null,
        genres:            meta?.genres       ? JSON.stringify(meta.genres)    : null,
        rating:            meta?.rating       || null,
        rtScore:           meta?.rtScore      || null,
        runtime:           meta?.runtime      || null,
        language:          meta?.language     || null,
        cast:              meta?.cast         ? JSON.stringify(meta.cast)      : null,
        director:          meta?.director     || null,
        certification:     meta?.certification || null,
        quality:           quality.quality      || null,
        hdr:               quality.hdr          ? 1 : 0,
        dolbyVision:       quality.dolbyVision  ? 1 : 0,
        atmos:             quality.atmos        ? 1 : 0,
        subtitles:         subs.length          ? JSON.stringify(subs) : null,
      });

      scanState.processed++;
    }
  } catch (err) {
    scanState.errors.push(err.message);
    console.error('[scan] Fatal error:', err);
  } finally {
    scanState.inProgress = false;
  }
}

app.post('/api/scan', async (req, res) => {
  if (scanState.inProgress) return res.json({ message: 'Scan already running', ...scanState });

  const config = db.getConfig();
  if (!config.mediaFolders?.length) {
    return res.status(400).json({ error: 'No media folders configured' });
  }

  res.json({ message: 'Scan started' });
  runScan().catch(err => console.error('[scan]', err));
});

app.get('/api/scan/progress', (_req, res) => {
  res.json(scanState);
});

// ── Stream API ─────────────────────────────────────────────────────────────────
const MIME = {
  '.mp4':  'video/mp4',
  '.mkv':  'video/x-matroska',
  '.webm': 'video/webm',
  '.avi':  'video/x-msvideo',
  '.mov':  'video/quicktime',
  '.m4v':  'video/mp4',
  '.wmv':  'video/x-ms-wmv',
  '.flv':  'video/x-flv',
  '.mpg':  'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.ts':   'video/mp2t',
  '.m2ts': 'video/mp2t',
  '.vob':  'video/dvd',
};

app.get('/api/stream/:id', (req, res) => {
  const item = db.getMediaById(parseInt(req.params.id, 10));
  if (!item) return res.status(404).json({ error: 'Not found' });

  if (!fs.existsSync(item.path)) return res.status(404).json({ error: 'File not found on disk' });

  const stat        = fs.statSync(item.path);
  const fileSize    = stat.size;
  const ext         = path.extname(item.path).toLowerCase();
  const contentType = MIME[ext] || 'video/mp4';
  const range       = req.headers.range;

  if (range) {
    const [s, e]  = range.replace(/bytes=/, '').split('-');
    const start   = parseInt(s, 10);

    // Return 416 Range Not Satisfiable when start is beyond the file
    if (isNaN(start) || start >= fileSize) {
      res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
      return res.end();
    }

    // Clamp end so it never exceeds the last byte of the file.
    // Fall back to a 10 MB chunk when the end byte is absent or unparseable.
    const parsedEnd = e ? parseInt(e, 10) : NaN;
    const end   = Math.min(isNaN(parsedEnd) ? start + 10 * 1024 * 1024 : parsedEnd, fileSize - 1);
    const chunk = end - start + 1;

    res.writeHead(206, {
      'Content-Range':  `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges':  'bytes',
      'Content-Length': chunk,
      'Content-Type':   contentType,
    });
    const readStream = fs.createReadStream(item.path, { start, end });
    readStream.on('error', (streamErr) => {
      console.error('[stream] Read error:', streamErr.message);
      if (!res.writableEnded) res.end();
    });
    readStream.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type':   contentType,
      'Accept-Ranges':  'bytes',
    });
    const readStream = fs.createReadStream(item.path);
    readStream.on('error', (streamErr) => {
      console.error('[stream] Read error:', streamErr.message);
      if (!res.writableEnded) res.end();
    });
    readStream.pipe(res);
  }
});

// ── Transcode API (FFmpeg fallback for unsupported codecs) ─────────────────────
app.get('/api/transcode/:id', (req, res) => {
  if (!ffmpegAvailable) {
    return res.status(503).json({ error: 'FFmpeg not available on this server' });
  }

  const item = db.getMediaById(parseInt(req.params.id, 10));
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (!fs.existsSync(item.path)) return res.status(404).json({ error: 'File not found on disk' });

  // Parse optional start time for seeking
  const startSec = req.query.start ? parseFloat(req.query.start) : 0;

  res.writeHead(200, {
    'Content-Type':      'video/mp4',
    'Transfer-Encoding': 'chunked',
    'Cache-Control':     'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });

  const args = [
    '-loglevel', 'error',
  ];
  if (startSec > 0) {
    args.push('-ss', String(startSec));
  }
  args.push(
    '-i', item.path,
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '23',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ac', '2',          // down-mix to stereo (handles multi-channel audio)
    '-movflags', 'frag_keyframe+empty_moov+faststart',
    '-f', 'mp4',
    'pipe:1',
  );

  const ffProc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  ffProc.stdout.pipe(res);
  ffProc.stderr.on('data', d => console.error('[ffmpeg transcode]', d.toString().trim()));

  req.on('close', () => { try { ffProc.kill('SIGTERM'); } catch {} });
  ffProc.on('error', err => {
    console.error('[ffmpeg] spawn error:', err.message);
    if (!res.headersSent) res.status(500).end();
  });
});


app.get('/api/subtitles/:mediaId/:subIndex', (req, res) => {
  const item = db.getMediaById(parseInt(req.params.mediaId, 10));
  if (!item) return res.status(404).json({ error: 'Not found' });

  const subs = item.subtitles ? JSON.parse(item.subtitles) : [];
  const sub  = subs[parseInt(req.params.subIndex, 10)];
  if (!sub || !fs.existsSync(sub.path)) return res.status(404).json({ error: 'Subtitle file not found' });

  const ext     = path.extname(sub.path).toLowerCase();
  let   content = fs.readFileSync(sub.path, 'utf8');

  if (ext !== '.vtt') content = srtToVtt(content);

  res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
  res.send(content);
});

function srtToVtt(src) {
  return 'WEBVTT\n\n' + src
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2') // commas → dots in timestamps
    .replace(/^\d+\s*\n/gm, '')                         // strip sequence numbers
    .trim();
}

// ── Watch Progress API ─────────────────────────────────────────────────────────
app.post('/api/progress/:id', (req, res) => {
  const { position, duration } = req.body;
  db.saveProgress(parseInt(req.params.id, 10), position, duration);
  res.json({ success: true });
});

app.get('/api/continue', (_req, res) => {
  res.json(db.getContinueWatching().map(parseMedia));
});

// ── Favourite / Watchlist API ──────────────────────────────────────────────────
app.post('/api/media/:id/favorite', (req, res) => {
  const val = db.toggleFavorite(parseInt(req.params.id, 10));
  res.json({ favorite: val });
});

app.post('/api/media/:id/watchlist', (req, res) => {
  const val = db.toggleWatchlist(parseInt(req.params.id, 10));
  res.json({ watchlisted: val });
});

// ── Stats API ──────────────────────────────────────────────────────────────────
app.get('/api/stats', (_req, res) => {
  res.json(db.getStats());
});

// ── Surprise Me API ────────────────────────────────────────────────────────────
app.get('/api/surprise', (req, res) => {
  const { maxRuntime, minRating, genre } = req.query;
  const item = db.getSurprise({
    maxRuntime: maxRuntime ? parseInt(maxRuntime, 10) : undefined,
    minRating:  minRating  ? parseFloat(minRating)   : undefined,
    genre:      genre      || undefined,
  });
  if (!item) return res.status(404).json({ error: 'No matching unwatched movies found' });
  res.json(parseMedia(item));
});

// ── SPA Catch-all ──────────────────────────────────────────────────────────────
app.get('/{*path}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🎬  Lumière  →  http://localhost:${PORT}\n`);

  // Auto-scan on startup: quietly pick up any new files in configured folders
  const cfg = db.getConfig();
  if (cfg.setupComplete && cfg.mediaFolders?.length) {
    console.log('[startup] Auto-scanning media folders for new files…');
    runScan().catch(err => console.error('[startup scan]', err));
  }
});
