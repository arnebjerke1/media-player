'use strict';

const { Database } = require('node-sqlite3-wasm');
const path         = require('path');
const fs           = require('fs');

const DATA_DIR   = path.join(__dirname, '..', 'data');
const DB_PATH    = path.join(DATA_DIR, 'media.db');
const CFG_PATH   = path.join(DATA_DIR, 'config.json');

const CFG_DEFAULTS = {
  theme:         'spotlight',
  mediaFolders:  [],
  tmdbApiKey:    process.env.TMDB_API_KEY || '',
  omdbApiKey:    process.env.OMDB_API_KEY || '',
  setupComplete: false,
};

let db;

// ── Initialise ─────────────────────────────────────────────────────────────────
function init() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  db = new Database(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS media (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      path          TEXT    UNIQUE NOT NULL,
      filename      TEXT    NOT NULL,
      title         TEXT,
      year          INTEGER,
      tmdb_id       INTEGER,
      imdb_id       TEXT,
      overview      TEXT,
      tagline       TEXT,
      poster_path   TEXT,
      backdrop_path TEXT,
      genres        TEXT,        -- JSON array
      rating        REAL,
      rt_score      INTEGER,
      runtime       INTEGER,
      language      TEXT,
      cast          TEXT,        -- JSON array
      director      TEXT,
      subtitles     TEXT,        -- JSON array
      quality       TEXT,        -- '4K','1080p','720p','480p'
      hdr           INTEGER DEFAULT 0,
      dolby_vision  INTEGER DEFAULT 0,
      atmos         INTEGER DEFAULT 0,
      favorite      INTEGER DEFAULT 0,
      watchlisted   INTEGER DEFAULT 0,
      added_at      INTEGER DEFAULT (unixepoch()),
      last_updated  INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS watch_progress (
      media_id     INTEGER PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
      position     REAL    DEFAULT 0,
      duration     REAL    DEFAULT 0,
      completed    INTEGER DEFAULT 0,
      last_watched INTEGER DEFAULT (unixepoch())
    );
  `);
}

// ── Config ─────────────────────────────────────────────────────────────────────
function getConfig() {
  if (!fs.existsSync(CFG_PATH)) return { ...CFG_DEFAULTS };
  try {
    return { ...CFG_DEFAULTS, ...JSON.parse(fs.readFileSync(CFG_PATH, 'utf8')) };
  } catch {
    return { ...CFG_DEFAULTS };
  }
}

function saveConfig(updates) {
  const merged = { ...getConfig(), ...updates };
  fs.writeFileSync(CFG_PATH, JSON.stringify(merged, null, 2));
}

// ── Media CRUD ─────────────────────────────────────────────────────────────────
function getAllMedia() {
  return db.all(`
    SELECT m.*, wp.position, wp.duration, wp.completed, wp.last_watched
    FROM   media m
    LEFT JOIN watch_progress wp ON m.id = wp.media_id
    ORDER BY m.title ASC
  `);
}

function getMediaById(id) {
  return db.get(`
    SELECT m.*, wp.position, wp.duration, wp.completed, wp.last_watched
    FROM   media m
    LEFT JOIN watch_progress wp ON m.id = wp.media_id
    WHERE  m.id = ?
  `, [id]);
}

function getMediaByPath(filePath) {
  return db.get('SELECT id FROM media WHERE path = ?', [filePath]);
}

function saveMedia(item) {
  // node-sqlite3-wasm requires named-parameter objects to have the '@' prefix on each key
  const params = Object.fromEntries(Object.entries(item).map(([k, v]) => ['@' + k, v]));
  return db.run(`
    INSERT OR REPLACE INTO media
      (path, filename, title, year, tmdb_id, imdb_id, overview, tagline,
       poster_path, backdrop_path, genres, rating, rt_score, runtime,
       language, cast, director, subtitles,
       quality, hdr, dolby_vision, atmos,
       added_at, last_updated)
    VALUES
      (@path, @filename, @title, @year, @tmdbId, @imdbId, @overview, @tagline,
       @posterPath, @backdropPath, @genres, @rating, @rtScore, @runtime,
       @language, @cast, @director, @subtitles,
       @quality, @hdr, @dolbyVision, @atmos,
       unixepoch(), unixepoch())
  `, params);
}

function updateMedia(id, u) {
  const map = {
    title: u.title, year: u.year, tmdb_id: u.tmdbId, imdb_id: u.imdbId,
    overview: u.overview, tagline: u.tagline,
    poster_path: u.posterPath, backdrop_path: u.backdropPath,
    genres: u.genres, rating: u.rating, rt_score: u.rtScore,
    runtime: u.runtime, language: u.language, cast: u.cast, director: u.director,
  };
  const fields = Object.entries(map).filter(([, v]) => v !== undefined);
  if (!fields.length) return;
  const set  = fields.map(([k]) => `${k} = ?`).join(', ');
  const vals = fields.map(([, v]) => v);
  db.run(`UPDATE media SET ${set}, last_updated = unixepoch() WHERE id = ?`, [...vals, id]);
}

function toggleFavorite(id) {
  db.run('UPDATE media SET favorite = 1 - favorite WHERE id = ?', [id]);
  return db.get('SELECT favorite FROM media WHERE id = ?', [id])?.favorite;
}

function toggleWatchlist(id) {
  db.run('UPDATE media SET watchlisted = 1 - watchlisted WHERE id = ?', [id]);
  return db.get('SELECT watchlisted FROM media WHERE id = ?', [id])?.watchlisted;
}

function getStats() {
  const total      = db.get('SELECT COUNT(*) AS n FROM media').n;
  const watched    = db.get('SELECT COUNT(*) AS n FROM watch_progress WHERE completed = 1').n;
  const inProgress = db.get('SELECT COUNT(*) AS n FROM watch_progress WHERE completed = 0 AND position > 30').n;
  const favorites  = db.get('SELECT COUNT(*) AS n FROM media WHERE favorite = 1').n;

  // Aggregate hours from runtime (minutes)
  const hours = db.get(
    'SELECT SUM(m.runtime) AS mins FROM media m INNER JOIN watch_progress wp ON m.id = wp.media_id WHERE wp.completed = 1'
  ).mins || 0;

  // Genre breakdown (top 5)
  const genreRows = db.all('SELECT genres FROM media WHERE genres IS NOT NULL');
  const genreMap  = {};
  for (const row of genreRows) {
    for (const g of JSON.parse(row.genres)) {
      genreMap[g] = (genreMap[g] || 0) + 1;
    }
  }
  const topGenres = Object.entries(genreMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  return { total, watched, inProgress, favorites, hoursWatched: Math.round(hours / 60), topGenres };
}

/** Random unwatched movie; optionally filter by maxRuntime and minRating. */
function getSurprise({ maxRuntime, minRating, genre } = {}) {
  let sql = `
    SELECT m.*
    FROM   media m
    LEFT JOIN watch_progress wp ON m.id = wp.media_id
    WHERE  (wp.completed IS NULL OR wp.completed = 0)
      AND  (wp.position  IS NULL OR wp.position  < 30)
  `;
  const params = [];
  if (maxRuntime) { sql += ' AND (m.runtime IS NULL OR m.runtime <= ?)'; params.push(maxRuntime); }
  if (minRating)  { sql += ' AND (m.rating  IS NULL OR m.rating  >= ?)'; params.push(minRating); }
  if (genre)      { sql += ' AND m.genres LIKE ?'; params.push(`%${genre}%`); }
  sql += ' ORDER BY RANDOM() LIMIT 1';
  return db.get(sql, params) || null;
}

function deleteMedia(id) {
  db.run('DELETE FROM media WHERE id = ?', [id]);
}

// ── Watch Progress ─────────────────────────────────────────────────────────────
function saveProgress(mediaId, position, duration) {
  const completed = duration > 0 && position / duration >= 0.9 ? 1 : 0;
  db.run(`
    INSERT INTO watch_progress (media_id, position, duration, completed, last_watched)
    VALUES (?, ?, ?, ?, unixepoch())
    ON CONFLICT(media_id) DO UPDATE SET
      position     = excluded.position,
      duration     = excluded.duration,
      completed    = excluded.completed,
      last_watched = excluded.last_watched
  `, [mediaId, position, duration, completed]);
}

function getContinueWatching() {
  return db.all(`
    SELECT m.*, wp.position, wp.duration, wp.completed, wp.last_watched
    FROM   media m
    INNER JOIN watch_progress wp ON m.id = wp.media_id
    WHERE  wp.completed = 0 AND wp.position > 30
    ORDER BY wp.last_watched DESC
    LIMIT 20
  `);
}

module.exports = {
  init, getConfig, saveConfig,
  getAllMedia, getMediaById, getMediaByPath, saveMedia, updateMedia, deleteMedia,
  toggleFavorite, toggleWatchlist,
  saveProgress, getContinueWatching,
  getStats, getSurprise,
};
