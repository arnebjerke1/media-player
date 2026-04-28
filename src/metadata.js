'use strict';

const axios = require('axios');

const TMDB_BASE     = 'https://api.themoviedb.org/3';
const OMDB_BASE     = 'https://www.omdbapi.com';
const IMG_W500      = 'https://image.tmdb.org/t/p/w500';
const IMG_W1280     = 'https://image.tmdb.org/t/p/w1280';
const REQUEST_OPTS  = { timeout: 10_000 };

/**
 * Fetch rich metadata for a movie title.
 * Uses TMDB for everything; OMDB only for Rotten Tomatoes score.
 *
 * @param {string}      title
 * @param {number|null} year
 * @param {string}      tmdbApiKey
 * @param {string}      [omdbApiKey]
 * @returns {Promise<object|null>}
 */
async function fetchMetadata(title, year, tmdbApiKey, omdbApiKey) {
  if (!tmdbApiKey) return null;

  try {
    // 1. Search – first with year, fall back without
    let result = await searchMovie(title, year, tmdbApiKey);
    if (!result && year) result = await searchMovie(title, null, tmdbApiKey);
    if (!result) return null;

    // 2. Full details + credits + external IDs in one request
    const detail = await getDetails(result.id, tmdbApiKey);

    // 3. Rotten Tomatoes via OMDB (optional)
    let rtScore = null;
    if (omdbApiKey && detail.external_ids?.imdb_id) {
      rtScore = await fetchRTScore(detail.external_ids.imdb_id, omdbApiKey);
    }

    const releaseYear = detail.release_date
      ? parseInt(detail.release_date.split('-')[0], 10)
      : year;

    return {
      title:       detail.title,
      year:        releaseYear,
      tmdbId:      detail.id,
      imdbId:      detail.external_ids?.imdb_id  || null,
      overview:    detail.overview               || null,
      tagline:     detail.tagline                || null,
      posterPath:  detail.poster_path   ? `${IMG_W500}${detail.poster_path}`   : null,
      backdropPath:detail.backdrop_path ? `${IMG_W1280}${detail.backdrop_path}` : null,
      genres:      (detail.genres  || []).map(g => g.name),
      rating:      detail.vote_average ? Math.round(detail.vote_average * 10) / 10 : null,
      rtScore,
      runtime:     detail.runtime   || null,
      language:    detail.original_language || null,
      cast:        (detail.credits?.cast  || []).slice(0, 8).map(c => c.name),
      director:    (detail.credits?.crew  || []).find(c => c.job === 'Director')?.name || null,
    };
  } catch (err) {
    console.error('[metadata] fetchMetadata error:', err.message);
    return null;
  }
}

async function searchMovie(title, year, apiKey) {
  const params = new URLSearchParams({
    api_key: apiKey,
    query:   title,
    language: 'en-US',
    page: '1',
    include_adult: 'false',
  });
  if (year) params.set('year', String(year));

  const res = await axios.get(`${TMDB_BASE}/search/movie?${params}`, REQUEST_OPTS);
  return res.data.results?.[0] || null;
}

async function getDetails(movieId, apiKey) {
  const res = await axios.get(
    `${TMDB_BASE}/movie/${movieId}?api_key=${apiKey}&append_to_response=external_ids,credits`,
    REQUEST_OPTS,
  );
  return res.data;
}

async function fetchRTScore(imdbId, omdbApiKey) {
  try {
    const res = await axios.get(
      `${OMDB_BASE}/?apikey=${omdbApiKey}&i=${imdbId}`,
      { timeout: 8_000 },
    );
    const rt = (res.data.Ratings || []).find(r => r.Source === 'Rotten Tomatoes');
    return rt ? parseInt(rt.Value, 10) : null;
  } catch {
    return null;
  }
}

module.exports = { fetchMetadata };
