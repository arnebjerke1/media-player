'use strict';

const fs   = require('fs');
const path = require('path');

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.m4v', '.wmv', '.webm',
  '.flv', '.mpg', '.mpeg', '.ts', '.m2ts', '.vob', '.ogv',
  '.3gp', '.f4v', '.rmvb', '.rm', '.divx',
]);

const SUBTITLE_EXTENSIONS = new Set(['.srt', '.vtt', '.ass', '.ssa', '.sub']);

const SKIP_DIRS = new Set([
  'node_modules', 'System Volume Information', '$RECYCLE.BIN',
  'Windows', 'Program Files', 'Program Files (x86)',
]);

/**
 * Recursively scan a directory for video files.
 * @param {string}   dirPath
 * @param {string[]} [results]
 * @returns {string[]} Absolute file paths
 */
function scanDirectory(dirPath, results = []) {
  if (!fs.existsSync(dirPath)) {
    console.warn(`[scanner] Directory not found: ${dirPath}`);
    return results;
  }

  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    console.warn(`[scanner] Cannot read ${dirPath}: ${err.message}`);
    return results;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (SKIP_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      scanDirectory(fullPath, results);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!VIDEO_EXTENSIONS.has(ext)) continue;

      // Skip sample / trailer / bonus files
      if (/\b(sample|trailer|featurette|behind.the.scenes|deleted.scene|interview|short)\b/i.test(entry.name)) continue;

      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Find subtitle files sitting alongside a video file.
 * Returns an array of { path, label, lang } objects.
 */
function findSubtitles(videoPath) {
  const dir  = path.dirname(videoPath);
  const base = path.basename(videoPath, path.extname(videoPath));
  const found = [];

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext      = path.extname(entry.name).toLowerCase();
    const entryBase = path.basename(entry.name, ext);

    if (!SUBTITLE_EXTENSIONS.has(ext)) continue;
    if (!entryBase.toLowerCase().startsWith(base.toLowerCase())) continue;

    // Derive a human-readable label from the suffix after the base name
    const suffix = entryBase.slice(base.length).replace(/^[-. _]/, '');
    const label  = suffix || 'Default';
    const lang   = suffix.toLowerCase().slice(0, 2) || 'en';

    found.push({ path: path.join(dir, entry.name), label, lang });
  }

  return found;
}

module.exports = { scanDirectory, findSubtitles };
