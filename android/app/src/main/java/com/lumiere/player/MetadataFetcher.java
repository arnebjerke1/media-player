package com.lumiere.player;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Java port of src/metadata.js — fetches movie/TV metadata from TMDB and OMDB.
 * All methods are synchronous and intended to be called from background threads.
 */
public final class MetadataFetcher {

    private MetadataFetcher() {}

    private static final String TMDB_BASE = "https://api.themoviedb.org/3";
    private static final String OMDB_BASE = "https://www.omdbapi.com";
    private static final String IMG_W500  = "https://image.tmdb.org/t/p/w500";
    private static final String IMG_W1280 = "https://image.tmdb.org/t/p/w1280";
    private static final int    TIMEOUT   = 10_000;

    // ── Public API ────────────────────────────────────────────────────────────

    /** Fetch full metadata for a movie (title + optional year). Returns null on failure. */
    public static JSONObject fetchMetadata(String title, Integer year,
                                           String tmdbKey, String omdbKey) {
        if (tmdbKey == null || tmdbKey.isEmpty()) return null;
        try {
            // 1. Search
            JSONObject result = searchMovie(title, year, tmdbKey);
            if (result == null && year != null) result = searchMovie(title, null, tmdbKey);
            if (result == null) return null;

            int movieId = result.getInt("id");

            // 2. Full details + credits + external IDs
            JSONObject detail = getMovieDetails(movieId, tmdbKey);
            if (detail == null) return null;

            // 3. RT score via OMDB (optional)
            Integer rtScore = null;
            String  imdbId  = optString(detail, "external_ids", "imdb_id");
            if (omdbKey != null && !omdbKey.isEmpty() && imdbId != null) {
                rtScore = fetchRTScore(imdbId, omdbKey);
            }

            Integer releaseYear = null;
            String rd = detail.optString("release_date", "");
            if (rd.length() >= 4) {
                try { releaseYear = Integer.parseInt(rd.substring(0, 4)); } catch (NumberFormatException ignored) {}
            }

            JSONObject out = new JSONObject();
            out.put("title",        detail.optString("title",    title));
            out.put("year",         releaseYear != null ? releaseYear : (year != null ? year : JSONObject.NULL));
            out.put("tmdbId",       detail.getInt("id"));
            out.put("imdbId",       imdbId != null ? imdbId : JSONObject.NULL);
            out.put("overview",     detail.optString("overview",  null));
            out.put("tagline",      detail.optString("tagline",   null));
            String poster   = detail.optString("poster_path",   "");
            String backdrop = detail.optString("backdrop_path", "");
            out.put("posterPath",   !poster.isEmpty()   ? IMG_W500  + poster   : JSONObject.NULL);
            out.put("backdropPath", !backdrop.isEmpty() ? IMG_W1280 + backdrop : JSONObject.NULL);
            out.put("genres",       genreNames(detail.optJSONArray("genres")));
            double va = detail.optDouble("vote_average", 0);
            out.put("rating",       va > 0 ? Math.round(va * 10.0) / 10.0 : JSONObject.NULL);
            out.put("rtScore",      rtScore != null ? rtScore : JSONObject.NULL);
            out.put("runtime",      detail.opt("runtime"));
            out.put("language",     detail.optString("original_language", null));
            out.put("cast",         castNames(detail, "cast",  8));
            out.put("director",     directorName(detail));
            out.put("certification", certFromReleaseDates(detail.optJSONObject("release_dates")));
            return out;
        } catch (Exception e) {
            android.util.Log.w("MetadataFetcher", "fetchMetadata: " + e.getMessage());
            return null;
        }
    }

    /** Fetch show-level metadata for a TV series. Returns null on failure. */
    public static JSONObject fetchTvMetadata(String showName, String tmdbKey, String omdbKey) {
        if (tmdbKey == null || tmdbKey.isEmpty()) return null;
        try {
            String url = TMDB_BASE + "/search/tv?api_key=" + enc(tmdbKey) +
                         "&query=" + enc(showName) + "&language=en-US&page=1";
            JSONObject res = httpGet(url);
            if (res == null) return null;
            JSONArray results = res.optJSONArray("results");
            if (results == null || results.length() == 0) return null;

            int tvId = results.getJSONObject(0).getInt("id");

            JSONObject detail = httpGet(TMDB_BASE + "/tv/" + tvId +
                "?api_key=" + enc(tmdbKey) + "&append_to_response=external_ids,credits");
            if (detail == null) return null;

            Integer rtScore = null;
            String  imdbId  = optString(detail, "external_ids", "imdb_id");
            if (omdbKey != null && !omdbKey.isEmpty() && imdbId != null) {
                rtScore = fetchRTScore(imdbId, omdbKey);
            }

            Integer firstAirYear = null;
            String fad = detail.optString("first_air_date", "");
            if (fad.length() >= 4) {
                try { firstAirYear = Integer.parseInt(fad.substring(0, 4)); } catch (NumberFormatException ignored) {}
            }

            JSONArray runtimes = detail.optJSONArray("episode_run_time");
            Object runtime = (runtimes != null && runtimes.length() > 0)
                ? runtimes.get(0) : JSONObject.NULL;

            // Director = created_by names joined
            JSONArray createdBy = detail.optJSONArray("created_by");
            StringBuilder dirBuf = new StringBuilder();
            if (createdBy != null) {
                for (int i = 0; i < createdBy.length(); i++) {
                    if (dirBuf.length() > 0) dirBuf.append(", ");
                    dirBuf.append(createdBy.getJSONObject(i).optString("name", ""));
                }
            }

            JSONObject out = new JSONObject();
            out.put("title",        detail.optString("name", showName));
            out.put("year",         firstAirYear != null ? firstAirYear : JSONObject.NULL);
            out.put("tmdbId",       tvId);
            out.put("imdbId",       imdbId != null ? imdbId : JSONObject.NULL);
            out.put("overview",     detail.optString("overview",  null));
            out.put("tagline",      detail.optString("tagline",   null));
            String poster   = detail.optString("poster_path",   "");
            String backdrop = detail.optString("backdrop_path", "");
            out.put("posterPath",   !poster.isEmpty()   ? IMG_W500  + poster   : JSONObject.NULL);
            out.put("backdropPath", !backdrop.isEmpty() ? IMG_W1280 + backdrop : JSONObject.NULL);
            out.put("genres",       genreNames(detail.optJSONArray("genres")));
            double va = detail.optDouble("vote_average", 0);
            out.put("rating",       va > 0 ? Math.round(va * 10.0) / 10.0 : JSONObject.NULL);
            out.put("rtScore",      rtScore != null ? rtScore : JSONObject.NULL);
            out.put("runtime",      runtime);
            out.put("language",     detail.optString("original_language", null));
            out.put("cast",         castNames(detail, "cast", 8));
            out.put("director",     dirBuf.length() > 0 ? dirBuf.toString() : JSONObject.NULL);
            out.put("certification", JSONObject.NULL);
            return out;
        } catch (Exception e) {
            android.util.Log.w("MetadataFetcher", "fetchTvMetadata: " + e.getMessage());
            return null;
        }
    }

    /** Fetch season-specific poster URL from TMDB. Returns null on failure. */
    public static String fetchSeasonPoster(int tmdbId, int season, String tmdbKey) {
        if (tmdbKey == null || tmdbKey.isEmpty()) return null;
        try {
            JSONObject res = httpGet(TMDB_BASE + "/tv/" + tmdbId +
                "/season/" + season + "?api_key=" + enc(tmdbKey));
            if (res == null) return null;
            String p = res.optString("poster_path", "");
            return p.isEmpty() ? null : IMG_W500 + p;
        } catch (Exception e) {
            return null;
        }
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private static JSONObject searchMovie(String title, Integer year, String apiKey)
        throws Exception {
        String url = TMDB_BASE + "/search/movie?api_key=" + enc(apiKey) +
                     "&query=" + enc(title) + "&language=en-US&page=1&include_adult=false";
        if (year != null) url += "&year=" + year;
        JSONObject res = httpGet(url);
        if (res == null) return null;
        JSONArray results = res.optJSONArray("results");
        return (results != null && results.length() > 0) ? results.getJSONObject(0) : null;
    }

    private static JSONObject getMovieDetails(int movieId, String apiKey) throws Exception {
        return httpGet(TMDB_BASE + "/movie/" + movieId +
            "?api_key=" + enc(apiKey) +
            "&append_to_response=external_ids,credits,release_dates");
    }

    private static Integer fetchRTScore(String imdbId, String omdbKey) {
        try {
            JSONObject res = httpGet(OMDB_BASE + "/?apikey=" + enc(omdbKey) + "&i=" + enc(imdbId));
            if (res == null) return null;
            JSONArray ratings = res.optJSONArray("Ratings");
            if (ratings == null) return null;
            for (int i = 0; i < ratings.length(); i++) {
                JSONObject r = ratings.optJSONObject(i);
                if (r != null && "Rotten Tomatoes".equals(r.optString("Source"))) {
                    String v = r.optString("Value", "");
                    if (v.endsWith("%")) {
                        try { return Integer.parseInt(v.replace("%", "").trim()); } catch (NumberFormatException ignored) {}
                    }
                }
            }
        } catch (Exception ignored) {}
        return null;
    }

    static JSONObject httpGet(String urlStr) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
        conn.setConnectTimeout(TIMEOUT);
        conn.setReadTimeout(TIMEOUT);
        conn.setRequestProperty("Accept", "application/json");
        try {
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) return null;
            BufferedReader br = new BufferedReader(
                new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = br.readLine()) != null) sb.append(line);
            return new JSONObject(sb.toString());
        } finally {
            conn.disconnect();
        }
    }

    private static String enc(String s) {
        try { return java.net.URLEncoder.encode(s, "UTF-8"); } catch (Exception e) { return s; }
    }

    private static String optString(JSONObject parent, String childKey, String fieldKey) {
        try {
            JSONObject child = parent.optJSONObject(childKey);
            if (child == null) return null;
            String v = child.optString(fieldKey, "");
            return v.isEmpty() ? null : v;
        } catch (Exception e) { return null; }
    }

    private static String genreNames(JSONArray genres) {
        if (genres == null) return "[]";
        JSONArray out = new JSONArray();
        for (int i = 0; i < genres.length(); i++) {
            JSONObject g = genres.optJSONObject(i);
            if (g != null) out.put(g.optString("name"));
        }
        return out.toString();
    }

    private static String castNames(JSONObject detail, String listKey, int limit) {
        try {
            JSONObject credits = detail.optJSONObject("credits");
            if (credits == null) return "[]";
            JSONArray list = credits.optJSONArray(listKey);
            if (list == null) return "[]";
            JSONArray out = new JSONArray();
            for (int i = 0; i < Math.min(limit, list.length()); i++) {
                out.put(list.getJSONObject(i).optString("name"));
            }
            return out.toString();
        } catch (Exception e) { return "[]"; }
    }

    private static String directorName(JSONObject detail) {
        try {
            JSONObject credits = detail.optJSONObject("credits");
            if (credits == null) return null;
            JSONArray crew = credits.optJSONArray("crew");
            if (crew == null) return null;
            for (int i = 0; i < crew.length(); i++) {
                JSONObject m = crew.getJSONObject(i);
                if ("Director".equals(m.optString("job"))) return m.optString("name");
            }
        } catch (Exception ignored) {}
        return null;
    }

    private static String certFromReleaseDates(JSONObject releaseDates) {
        if (releaseDates == null) return null;
        try {
            JSONArray results = releaseDates.optJSONArray("results");
            if (results == null) return null;
            // Find US entries
            for (int i = 0; i < results.length(); i++) {
                JSONObject r = results.getJSONObject(i);
                if (!"US".equals(r.optString("iso_3166_1"))) continue;
                JSONArray dates = r.optJSONArray("release_dates");
                if (dates == null) continue;
                // Priority: type 3 (theatrical), 4 (digital), then any
                for (int type : new int[]{3, 4, 1, 2, 5, 6}) {
                    for (int j = 0; j < dates.length(); j++) {
                        JSONObject d = dates.getJSONObject(j);
                        if (d.optInt("type") == type) {
                            String cert = d.optString("certification", "");
                            if (!cert.isEmpty()) return cert;
                        }
                    }
                }
            }
        } catch (Exception ignored) {}
        return null;
    }
}
