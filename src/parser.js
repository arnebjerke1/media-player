'use strict';

const path = require('path');

// TV show episode pattern: Show.Name.S01E02.Episode.Title or S01E02E03 etc.
const TV_RE  = /^(.*?)\s*[Ss](\d{1,2})[Ee](\d{1,2})/;
// Alternative: Show.Name.1x02 (season x episode)
const TV_RE2 = /^(.*?)\s*(\d{1,2})x(\d{1,3})\b/i;

// Tags that reliably mark the end of a meaningful title in torrent-style filenames
const CUTOFF_RE =
  /\b(19[0-9]{2}|20[0-2][0-9]|2160p|1080p|1080i|720p|720i|480p|480i|4k|uhd|fhd|bluray|blu-ray|bdrip|brrip|webrip|web-dl|webdl|web|hdtv|dvdrip|dvdscr|hdrip|dvd|x264|x265|h264|h265|hevc|xvid|divx|avc|vp9|av1|aac|ac3|dts|truehd|atmos|flac|mp3|hdr|hdr10|dolby|dolbyvision|dv|hlg|extended|theatrical|unrated|remastered|proper)\b/i;

/**
 * Parse a media filename into a clean title and optional year.
 *
 * Examples:
 *   "a.cat.named.bob.1080p.mkv"              → { title: "A Cat Named Bob", year: null }
 *   "The.Dark.Knight.2008.1080p.BluRay.mkv"  → { title: "The Dark Knight", year: 2008 }
 *   "Avengers Endgame (2019) 4K.mp4"         → { title: "Avengers Endgame", year: 2019 }
 */
function parseFilename(filename) {
  // Strip extension
  let name = filename.replace(/\.[a-z0-9]{2,4}$/i, '');

  // Replace separators with spaces
  name = name.replace(/[._]/g, ' ');

  // Find year (4 digits, 1900–2029)
  const yearMatch = name.match(/\b(19[0-9]{2}|20[0-2][0-9])\b/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : null;

  // Find the earliest cutoff: year OR quality/source/codec tag
  let cutoff = name.length;

  if (year) {
    const yi = name.indexOf(yearMatch[0]);
    if (yi > 0) cutoff = Math.min(cutoff, yi);
  }

  const qualMatch = name.match(CUTOFF_RE);
  if (qualMatch) {
    const qi = name.search(CUTOFF_RE);
    if (qi > 0) cutoff = Math.min(cutoff, qi);
  }

  let title = name.substring(0, cutoff).trim();
  title = title.replace(/\s+/g, ' ').replace(/[-\s]+$/, '').trim();

  // Fallback: use cleaned full name
  if (!title) title = name.replace(/[._]/g, ' ').trim();

  return { title: toTitleCase(title), year };
}

const MINOR = new Set([
  'a', 'an', 'the', 'and', 'but', 'or', 'for', 'nor', 'so', 'yet',
  'at', 'by', 'in', 'of', 'on', 'to', 'up', 'as', 'is', 'it',
  'via', 'vs', 'vs.', 'with', 'from', 'into', 'over',
]);

function toTitleCase(str) {
  return str
    .toLowerCase()
    .split(' ')
    .map((w, i) => {
      if (!w) return w;
      if (i > 0 && MINOR.has(w)) return w;
      return w[0].toUpperCase() + w.slice(1);
    })
    .join(' ');
}

/**
 * Detect technical quality attributes from a filename.
 * Returns { quality, hdr, dolbyVision, atmos }
 */
function detectQuality(filename) {
  const f = filename.toLowerCase();

  let quality = null;
  if (/\b(2160p|4k|uhd)\b/.test(f))      quality = '4K';
  else if (/\b1080p\b/.test(f))           quality = '1080p';
  else if (/\b720p\b/.test(f))            quality = '720p';
  else if (/\b480p\b/.test(f))            quality = '480p';

  const dolbyVision = /\b(dolby.?vision|dv\b|dovi)\b/.test(f);
  const hdr         = dolbyVision || /\b(hdr10\+|hdr10|hdr|hlg)\b/.test(f);
  const atmos       = /\b(atmos|truehd)\b/.test(f);

  return { quality, hdr, dolbyVision, atmos };
}

/**
 * Detect if a filename belongs to a TV show episode.
 * Returns { showName, season, episode } or null if not a TV show.
 *
 * Also accepts an optional filePath to derive show/season info from the
 * directory structure when the filename alone is not enough.
 *
 * Examples:
 *   "Breaking.Bad.S01E01.Pilot.mkv"            → { showName: "Breaking Bad", season: 1, episode: 1 }
 *   "Game.of.Thrones.s03e09.720p.mkv"          → { showName: "Game of Thrones", season: 3, episode: 9 }
 *   "Seinfeld.1x01.mkv"                        → { showName: "Seinfeld", season: 1, episode: 1 }
 *   "S01E01.mkv" in /Shows/Breaking Bad/Season 1/ → { showName: "Breaking Bad", season: 1, episode: 1 }
 */
function parseTvFilename(filename, filePath) {
  const name = filename.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[._]/g, ' ');

  // Try SxxExx format
  let match = name.match(TV_RE);
  if (match) {
    let rawShow = match[1].trim().replace(/[-\s]+$/, '').trim();
    if (!rawShow && filePath) {
      // No show name in filename — try to derive from parent directory
      rawShow = _showNameFromPath(filePath) || '';
    }
    if (!rawShow) return null;
    return {
      showName: toTitleCase(rawShow),
      season:   parseInt(match[2], 10),
      episode:  parseInt(match[3], 10),
    };
  }

  // Try NxNN format (e.g. "Seinfeld.1x01.mkv")
  match = name.match(TV_RE2);
  if (match) {
    let rawShow = match[1].trim().replace(/[-\s]+$/, '').trim();
    if (!rawShow && filePath) {
      rawShow = _showNameFromPath(filePath) || '';
    }
    if (!rawShow) return null;
    return {
      showName: toTitleCase(rawShow),
      season:   parseInt(match[2], 10),
      episode:  parseInt(match[3], 10),
    };
  }

  // No episode pattern in filename — try folder structure
  if (filePath) {
    return _detectTvFromPath(filePath, filename);
  }

  return null;
}

/**
 * Extract show name from a path like /media/TV/Breaking Bad/Season 1/ep.mkv
 * Returns the folder that sits directly above a "Season N" folder, or null.
 */
function _showNameFromPath(filePath) {
  const parts = path.dirname(filePath).split(path.sep);
  for (let i = parts.length - 1; i >= 1; i--) {
    if (/^[Ss]eason\s*\d+$/i.test(parts[i]) || /^[Ss]\d{1,2}$/i.test(parts[i])) {
      return parts[i - 1] || null;
    }
  }
  return null;
}

/**
 * Detect TV episode entirely from folder structure:
 *   /Shows/Breaking Bad/Season 1/01 - Pilot.mkv
 * Returns { showName, season, episode } or null.
 */
function _detectTvFromPath(filePath, filename) {
  const parts = path.dirname(filePath).split(path.sep);
  let showName = null;
  let season   = null;

  for (let i = parts.length - 1; i >= 1; i--) {
    const seasonMatch = parts[i].match(/^[Ss]eason\s*(\d+)$/i) || parts[i].match(/^[Ss](\d{1,2})$/i);
    if (seasonMatch) {
      season   = parseInt(seasonMatch[1], 10);
      showName = parts[i - 1] || null;
      break;
    }
  }

  if (!showName || season == null) return null;

  // Extract episode number from filename
  const base = filename.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[._]/g, ' ');
  const epMatch = base.match(
    /\b(?:[Ee]p(?:isode)?\s*\.?\s*(\d+)|[Ee](\d+)\b|^(\d+)\b)/
  );
  const episode = epMatch
    ? parseInt(epMatch[1] ?? epMatch[2] ?? epMatch[3], 10)
    : null;

  if (!episode) return null;

  return { showName: toTitleCase(showName), season, episode };
}

module.exports = { parseFilename, parseTvFilename, detectQuality };
