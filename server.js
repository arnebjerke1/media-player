'use strict';

require('dotenv').config();

const express = require('express');
const path    = require('path');
const fs      = require('fs');

const db                        = require('./src/db');
const { scanDirectory, findSubtitles } = require('./src/scanner');
const { fetchMetadata }         = require('./src/metadata');
const { parseFilename, detectQuality }  = require('./src/parser');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Boot ───────────────────────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
db.init();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Helpers ────────────────────────────────────────────────────────────────────
function parseMedia(item) {
  if (!item) return item;
  return {
    ...item,
    genres:    item.genres    ? JSON.parse(item.genres)    : [],
    cast:      item.cast      ? JSON.parse(item.cast)      : [],
    subtitles: item.subtitles ? JSON.parse(item.subtitles) : [],
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
  db.deleteMedia(parseInt(req.params.id, 10));
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
  });

  res.json(parseMedia(db.getMediaById(item.id)));
});

// ── Scan API ───────────────────────────────────────────────────────────────────
let scanState = { inProgress: false, total: 0, processed: 0, current: '', errors: [] };

app.post('/api/scan', async (req, res) => {
  if (scanState.inProgress) return res.json({ message: 'Scan already running', ...scanState });

  const config = db.getConfig();
  if (!config.mediaFolders?.length) {
    return res.status(400).json({ error: 'No media folders configured' });
  }

  res.json({ message: 'Scan started' });

  scanState = { inProgress: true, total: 0, processed: 0, current: '', errors: [] };

  try {
    const files = config.mediaFolders.flatMap(f => scanDirectory(f));
    scanState.total = files.length;

    for (const filePath of files) {
      scanState.current = path.basename(filePath);

      if (db.getMediaByPath(filePath)) {
        scanState.processed++;
        continue; // already indexed
      }

      const filename = path.basename(filePath);
      const parsed   = parseFilename(filename);
      const quality  = detectQuality(filename);
      const subs     = findSubtitles(filePath);

      let meta = null;
      if (config.tmdbApiKey) {
        meta = await fetchMetadata(parsed.title, parsed.year, config.tmdbApiKey, config.omdbApiKey);
      }

      db.saveMedia({
        path:         filePath,
        filename,
        title:        meta?.title        || parsed.title,
        year:         meta?.year         || parsed.year  || null,
        tmdbId:       meta?.tmdbId       || null,
        imdbId:       meta?.imdbId       || null,
        overview:     meta?.overview     || null,
        tagline:      meta?.tagline      || null,
        posterPath:   meta?.posterPath   || null,
        backdropPath: meta?.backdropPath || null,
        genres:       meta?.genres       ? JSON.stringify(meta.genres)    : null,
        rating:       meta?.rating       || null,
        rtScore:      meta?.rtScore      || null,
        runtime:      meta?.runtime      || null,
        language:     meta?.language     || null,
        cast:         meta?.cast         ? JSON.stringify(meta.cast)      : null,
        director:     meta?.director     || null,
        quality:      quality.quality      || null,
        hdr:          quality.hdr          ? 1 : 0,
        dolbyVision:  quality.dolbyVision  ? 1 : 0,
        atmos:        quality.atmos        ? 1 : 0,
        subtitles:    subs.length          ? JSON.stringify(subs) : null,
      });

      scanState.processed++;
    }
  } catch (err) {
    scanState.errors.push(err.message);
    console.error('[scan] Fatal error:', err);
  } finally {
    scanState.inProgress = false;
  }
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
    const end     = e ? parseInt(e, 10) : Math.min(start + 10 * 1024 * 1024, fileSize - 1);
    const chunk   = end - start + 1;

    res.writeHead(206, {
      'Content-Range':  `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges':  'bytes',
      'Content-Length': chunk,
      'Content-Type':   contentType,
    });
    fs.createReadStream(item.path, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type':   contentType,
      'Accept-Ranges':  'bytes',
    });
    fs.createReadStream(item.path).pipe(res);
  }
});

// ── Subtitles API ──────────────────────────────────────────────────────────────
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
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🎬  CinemaBox  →  http://localhost:${PORT}\n`);
});
