'use strict';

// TV show episode pattern: Show.Name.S01E02.Episode.Title or S01E02E03 etc.
const TV_RE = /^(.*?)\s*[Ss](\d{1,2})[Ee](\d{1,2})/;

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
 * Examples:
 *   "Breaking.Bad.S01E01.Pilot.mkv"  → { showName: "Breaking Bad", season: 1, episode: 1 }
 *   "Game.of.Thrones.s03e09.720p.mkv" → { showName: "Game of Thrones", season: 3, episode: 9 }
 */
function parseTvFilename(filename) {
  const name = filename.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[._]/g, ' ');
  const match = name.match(TV_RE);
  if (!match) return null;
  const rawShow = match[1].trim().replace(/[-\s]+$/, '').trim();
  if (!rawShow) return null;
  return {
    showName: toTitleCase(rawShow),
    season:   parseInt(match[2], 10),
    episode:  parseInt(match[3], 10),
  };
}

module.exports = { parseFilename, parseTvFilename, detectQuality };
