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
 */
async function fetchMetadata(title, year, tmdbApiKey, omdbApiKey) {
  if (!tmdbApiKey) return null;

  try {
    // 1. Search – first with year, fall back without
    let result = await searchMovie(title, year, tmdbApiKey);
    if (!result && year) result = await searchMovie(title, null, tmdbApiKey);
    if (!result) return null;

    // 2. Full details + credits + external IDs in one request
    const detail = await getMovieDetails(result.id, tmdbApiKey);

    // 3. Rotten Tomatoes via OMDB (optional)
    let rtScore = null;
    if (omdbApiKey && detail.external_ids?.imdb_id) {
      rtScore = await fetchRTScore(detail.external_ids.imdb_id, omdbApiKey);
    }

    const releaseYear = detail.release_date
      ? parseInt(detail.release_date.split('-')[0], 10)
      : year;

    return {
      title:        detail.title,
      year:         releaseYear,
      tmdbId:       detail.id,
      imdbId:       detail.external_ids?.imdb_id  || null,
      overview:     detail.overview               || null,
      tagline:      detail.tagline                || null,
      posterPath:   detail.poster_path   ? `${IMG_W500}${detail.poster_path}`   : null,
      backdropPath: detail.backdrop_path ? `${IMG_W1280}${detail.backdrop_path}` : null,
      genres:       (detail.genres  || []).map(g => g.name),
      rating:       detail.vote_average ? Math.round(detail.vote_average * 10) / 10 : null,
      rtScore,
      runtime:      detail.runtime   || null,
      language:     detail.original_language || null,
      cast:         (detail.credits?.cast  || []).slice(0, 8).map(c => c.name),
      director:     (detail.credits?.crew  || []).find(c => c.job === 'Director')?.name || null,
      certification: extractCertification(detail.release_dates),
    };
  } catch (err) {
    console.error('[metadata] fetchMetadata error:', err.message);
    return null;
  }
}

/**
 * Fetch metadata for a TV show from TMDB.
 * Returns show-level info (poster, backdrop, genres, overview, rating).
 */
async function fetchTvMetadata(showName, tmdbApiKey, omdbApiKey) {
  if (!tmdbApiKey) return null;

  try {
    const res = await axios.get(`${TMDB_BASE}/search/tv`, {
      params: { api_key: tmdbApiKey, query: showName, language: 'en-US', page: 1 },
      ...REQUEST_OPTS,
    });
    const result = res.data.results?.[0];
    if (!result) return null;

    // Full TV details
    const detail = await getTvDetails(result.id, tmdbApiKey);

    let rtScore = null;
    if (omdbApiKey && detail.external_ids?.imdb_id) {
      rtScore = await fetchRTScore(detail.external_ids.imdb_id, omdbApiKey);
    }

    const firstAirYear = detail.first_air_date
      ? parseInt(detail.first_air_date.split('-')[0], 10)
      : null;

    return {
      title:        detail.name,
      year:         firstAirYear,
      tmdbId:       detail.id,
      imdbId:       detail.external_ids?.imdb_id || null,
      overview:     detail.overview   || null,
      tagline:      detail.tagline    || null,
      posterPath:   detail.poster_path   ? `${IMG_W500}${detail.poster_path}`   : null,
      backdropPath: detail.backdrop_path ? `${IMG_W1280}${detail.backdrop_path}` : null,
      genres:       (detail.genres  || []).map(g => g.name),
      rating:       detail.vote_average ? Math.round(detail.vote_average * 10) / 10 : null,
      rtScore,
      runtime:      detail.episode_run_time?.[0] || null,
      language:     detail.original_language || null,
      cast:         (detail.credits?.cast || []).slice(0, 8).map(c => c.name),
      director:     (detail.created_by || []).map(c => c.name).join(', ') || null,
      certification: null,
    };
  } catch (err) {
    console.error('[metadata] fetchTvMetadata error:', err.message);
    return null;
  }
}

/**
 * Fetch season poster from TMDB for a specific TV show season.
 * Returns the poster_path URL or null.
 */
async function fetchSeasonPoster(tmdbId, season, tmdbApiKey) {
  if (!tmdbApiKey || !tmdbId) return null;
  try {
    const res = await axios.get(
      `${TMDB_BASE}/tv/${tmdbId}/season/${season}?api_key=${tmdbApiKey}`,
      REQUEST_OPTS,
    );
    return res.data.poster_path ? `${IMG_W500}${res.data.poster_path}` : null;
  } catch {
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

async function getMovieDetails(movieId, apiKey) {
  const res = await axios.get(
    `${TMDB_BASE}/movie/${movieId}?api_key=${apiKey}&append_to_response=external_ids,credits,release_dates`,
    REQUEST_OPTS,
  );
  return res.data;
}

async function getTvDetails(tvId, apiKey) {
  const res = await axios.get(
    `${TMDB_BASE}/tv/${tvId}?api_key=${apiKey}&append_to_response=external_ids,credits`,
    REQUEST_OPTS,
  );
  return res.data;
}

/** Extract US content rating (certification) from TMDB release_dates. */
function extractCertification(releaseDates) {
  if (!releaseDates?.results) return null;
  const us = releaseDates.results.find(r => r.iso_3166_1 === 'US');
  if (!us) return null;
  // TMDB release types: 1=Premiere, 2=Limited, 3=Theatrical, 4=Digital, 5=Physical, 6=TV
  // Prefer theatrical (3) then digital/home (4), then any other type with a certification.
  const TYPE_PRIORITY = [3, 4, 1, 2, 5, 6];
  const sorted = [...us.release_dates].sort((a, b) => {
    return TYPE_PRIORITY.indexOf(a.type) - TYPE_PRIORITY.indexOf(b.type);
  });
  return sorted.find(r => r.certification)?.certification || null;
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

module.exports = { fetchMetadata, fetchTvMetadata, fetchSeasonPoster };
