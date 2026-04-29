'use strict';

const axios = require('axios');

const TMDB_BASE     = 'https://api.themoviedb.org/3';
const OMDB_BASE     = 'https://www.omdbapi.com';
const TVMAZE_BASE   = 'https://api.tvmaze.com';
const IMG_W500      = 'https://image.tmdb.org/t/p/w500';
const IMG_W1280     = 'https://image.tmdb.org/t/p/w1280';
const REQUEST_OPTS  = { timeout: 10_000 };

/** Strip HTML tags returned by TVMaze summaries. */
function stripHtml(str) {
  return (str || '').replace(/<[^>]+>/g, '').trim();
}

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
 * Fetch metadata for a TV show using TVMaze (free, no API key required).
 * Returns show-level info: poster, genres, overview, rating, cast.
 *
 * The tmdbApiKey / omdbApiKey params are accepted for backward-compat but
 * only omdbApiKey is used (optional RT score via OMDB).
 */
async function fetchTvMetadata(showName, tmdbApiKey, omdbApiKey) {
  try {
    // TVMaze single-search — no API key required
    const searchRes = await axios.get(`${TVMAZE_BASE}/singlesearch/shows`, {
      params: { q: showName },
      ...REQUEST_OPTS,
    });
    const show = searchRes.data;
    if (!show) return null;

    // Full details + cast embedded in one call
    const detailRes = await axios.get(
      `${TVMAZE_BASE}/shows/${show.id}?embed[]=cast`,
      REQUEST_OPTS,
    );
    const d = detailRes.data;

    const firstAirYear = d.premiered
      ? parseInt(d.premiered.split('-')[0], 10)
      : null;

    const imdbId = d.externals?.imdb || null;

    // Optional: Rotten Tomatoes score via OMDB if key is available
    let rtScore = null;
    if (omdbApiKey && imdbId) {
      rtScore = await fetchRTScore(imdbId, omdbApiKey);
    }

    return {
      title:        d.name,
      year:         firstAirYear,
      tvMazeId:     d.id,
      tmdbId:       null,
      imdbId,
      overview:     stripHtml(d.summary),
      tagline:      null,
      posterPath:   d.image?.original || d.image?.medium || null,
      backdropPath: null,
      genres:       d.genres || [],
      rating:       d.rating?.average || null,
      rtScore,
      runtime:      d.averageRuntime || null,
      language:     d.language || null,
      cast:         (d._embedded?.cast || [])
                      .slice(0, 8)
                      .map(c => c.person?.name)
                      .filter(Boolean),
      director:     null,
      certification: null,
    };
  } catch (err) {
    console.error('[metadata] fetchTvMetadata error:', err.message);
    return null;
  }
}

/**
 * Fetch season poster from TVMaze (free, no API key required).
 * The third parameter (_unused) was the old tmdbApiKey — kept for backward compat.
 */
async function fetchSeasonPoster(tvMazeId, season, _unused) {
  if (!tvMazeId) return null;
  try {
    const res = await axios.get(`${TVMAZE_BASE}/shows/${tvMazeId}/seasons`, REQUEST_OPTS);
    const s = (res.data || []).find(s => s.number === season);
    return s?.image?.original || s?.image?.medium || null;
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
