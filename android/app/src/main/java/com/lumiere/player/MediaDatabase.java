package com.lumiere.player;

import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Android SQLite implementation of the media library database.
 * Schema mirrors src/db.js so the existing JS frontend works unchanged.
 */
public class MediaDatabase extends SQLiteOpenHelper {

    private static final String DB_NAME    = "media.db";
    private static final int    DB_VERSION = 2;

    private static final String PREFS_NAME   = "LumiereConfig";
    private static final String PREF_CONFIG  = "config_json";

    private static volatile MediaDatabase instance;

    private final SharedPreferences prefs;

    public static MediaDatabase getInstance(Context ctx) {
        if (instance == null) {
            synchronized (MediaDatabase.class) {
                if (instance == null) {
                    instance = new MediaDatabase(ctx.getApplicationContext());
                }
            }
        }
        return instance;
    }

    private MediaDatabase(Context ctx) {
        super(ctx, DB_NAME, null, DB_VERSION);
        prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        // Enable WAL mode for better concurrency
        getWritableDatabase().execSQL("PRAGMA journal_mode=WAL");
    }

    // ── Schema ────────────────────────────────────────────────────────────────
    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE IF NOT EXISTS media (" +
            "id              INTEGER PRIMARY KEY AUTOINCREMENT," +
            "path            TEXT    UNIQUE NOT NULL," +
            "content_uri     TEXT," +
            "filename        TEXT    NOT NULL," +
            "media_type      TEXT    DEFAULT 'movie'," +
            "title           TEXT," +
            "show_name       TEXT," +
            "season          INTEGER," +
            "episode         INTEGER," +
            "year            INTEGER," +
            "tmdb_id         INTEGER," +
            "imdb_id         TEXT," +
            "overview        TEXT," +
            "tagline         TEXT," +
            "poster_path     TEXT," +
            "backdrop_path   TEXT," +
            "season_poster_path TEXT," +
            "genres          TEXT," +
            "rating          REAL," +
            "rt_score        INTEGER," +
            "runtime         INTEGER," +
            "language        TEXT," +
            "cast            TEXT," +
            "director        TEXT," +
            "subtitles       TEXT," +
            "quality         TEXT," +
            "hdr             INTEGER DEFAULT 0," +
            "dolby_vision    INTEGER DEFAULT 0," +
            "atmos           INTEGER DEFAULT 0," +
            "certification   TEXT," +
            "favorite        INTEGER DEFAULT 0," +
            "watchlisted     INTEGER DEFAULT 0," +
            "added_at        INTEGER DEFAULT (strftime('%s','now'))," +
            "last_updated    INTEGER DEFAULT (strftime('%s','now'))" +
        ")");

        db.execSQL("CREATE TABLE IF NOT EXISTS watch_progress (" +
            "media_id     INTEGER PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE," +
            "position     REAL    DEFAULT 0," +
            "duration     REAL    DEFAULT 0," +
            "completed    INTEGER DEFAULT 0," +
            "last_watched INTEGER DEFAULT (strftime('%s','now'))" +
        ")");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        // Add content_uri column if upgrading from v1
        try { db.execSQL("ALTER TABLE media ADD COLUMN content_uri TEXT"); } catch (Exception ignored) {}
        try { db.execSQL("ALTER TABLE media ADD COLUMN season_poster_path TEXT"); } catch (Exception ignored) {}
        try { db.execSQL("ALTER TABLE media ADD COLUMN certification TEXT"); } catch (Exception ignored) {}
    }

    @Override
    public void onOpen(SQLiteDatabase db) {
        super.onOpen(db);
        db.execSQL("PRAGMA foreign_keys=ON");
    }

    // ── Config ────────────────────────────────────────────────────────────────
    public JSONObject getConfig() {
        JSONObject cfg = new JSONObject();
        try {
            String stored = prefs.getString(PREF_CONFIG, null);
            if (stored != null) cfg = new JSONObject(stored);

            // Apply defaults for missing keys
            if (!cfg.has("theme"))         cfg.put("theme", "spotlight");
            if (!cfg.has("mediaFolders"))  cfg.put("mediaFolders", new JSONArray());
            if (!cfg.has("setupComplete")) cfg.put("setupComplete", false);

            // BuildConfig keys win over empty saved values
            String tmdb = cfg.optString("tmdbApiKey", "");
            String omdb = cfg.optString("omdbApiKey", "");
            if (tmdb.isEmpty()) {
                String bk = BuildConfig.LUMIERE_TMDB_API_KEY;
                if (bk != null && !bk.isEmpty()) cfg.put("tmdbApiKey", bk);
                else cfg.put("tmdbApiKey", "");
            }
            if (omdb.isEmpty()) {
                String bk = BuildConfig.LUMIERE_OMDB_API_KEY;
                if (bk != null && !bk.isEmpty()) cfg.put("omdbApiKey", bk);
                else cfg.put("omdbApiKey", "");
            }
        } catch (JSONException e) {
            android.util.Log.e("MediaDatabase", "getConfig error", e);
        }
        return cfg;
    }

    public void saveConfig(JSONObject updates) {
        try {
            JSONObject current = getConfig();
            java.util.Iterator<String> keys = updates.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                current.put(k, updates.get(k));
            }
            prefs.edit().putString(PREF_CONFIG, current.toString()).apply();
        } catch (JSONException e) {
            android.util.Log.e("MediaDatabase", "saveConfig error", e);
        }
    }

    // ── Media CRUD ────────────────────────────────────────────────────────────
    public JSONArray getAllMedia() {
        SQLiteDatabase db = getReadableDatabase();
        JSONArray arr = new JSONArray();
        Cursor c = db.rawQuery(
            "SELECT m.*, wp.position, wp.duration, wp.completed, wp.last_watched " +
            "FROM media m LEFT JOIN watch_progress wp ON m.id = wp.media_id " +
            "ORDER BY m.title ASC", null);
        try {
            while (c.moveToNext()) arr.put(cursorToJson(c));
        } finally { c.close(); }
        return arr;
    }

    public JSONObject getMediaById(int id) {
        SQLiteDatabase db = getReadableDatabase();
        Cursor c = db.rawQuery(
            "SELECT m.*, wp.position, wp.duration, wp.completed, wp.last_watched " +
            "FROM media m LEFT JOIN watch_progress wp ON m.id = wp.media_id " +
            "WHERE m.id = ?", new String[]{String.valueOf(id)});
        try {
            if (c.moveToFirst()) return cursorToJson(c);
        } finally { c.close(); }
        return null;
    }

    /** Returns media id if the path/URI is already indexed, or -1. */
    public int getIdByPath(String path) {
        SQLiteDatabase db = getReadableDatabase();
        Cursor c = db.rawQuery(
            "SELECT id FROM media WHERE path = ? OR content_uri = ?",
            new String[]{path, path});
        try {
            if (c.moveToFirst()) return c.getInt(0);
        } finally { c.close(); }
        return -1;
    }

    /** Returns media id if this exact filename exists without a poster (needs re-scan). */
    public int getIdNeedingPoster(String filename) {
        SQLiteDatabase db = getReadableDatabase();
        Cursor c = db.rawQuery(
            "SELECT id FROM media WHERE filename = ? AND (poster_path IS NULL OR poster_path = '')",
            new String[]{filename});
        try {
            if (c.moveToFirst()) return c.getInt(0);
        } finally { c.close(); }
        return -1;
    }

    public long saveMedia(ContentValues cv) {
        SQLiteDatabase db = getWritableDatabase();
        return db.insertWithOnConflict("media", null, cv, SQLiteDatabase.CONFLICT_REPLACE);
    }

    public void updateMetadata(int id, ContentValues cv) {
        cv.put("last_updated", System.currentTimeMillis() / 1000L);
        getWritableDatabase().update("media", cv, "id = ?", new String[]{String.valueOf(id)});
    }

    public void deleteMedia(int id) {
        getWritableDatabase().delete("media", "id = ?", new String[]{String.valueOf(id)});
    }

    public int toggleFavorite(int id) {
        getWritableDatabase().execSQL(
            "UPDATE media SET favorite = 1 - favorite WHERE id = ?",
            new Object[]{id});
        SQLiteDatabase db = getReadableDatabase();
        Cursor c = db.rawQuery("SELECT favorite FROM media WHERE id = ?",
            new String[]{String.valueOf(id)});
        try { return c.moveToFirst() ? c.getInt(0) : 0; } finally { c.close(); }
    }

    public int toggleWatchlist(int id) {
        getWritableDatabase().execSQL(
            "UPDATE media SET watchlisted = 1 - watchlisted WHERE id = ?",
            new Object[]{id});
        SQLiteDatabase db = getReadableDatabase();
        Cursor c = db.rawQuery("SELECT watchlisted FROM media WHERE id = ?",
            new String[]{String.valueOf(id)});
        try { return c.moveToFirst() ? c.getInt(0) : 0; } finally { c.close(); }
    }

    // ── Watch Progress ────────────────────────────────────────────────────────
    public void saveProgress(int mediaId, double position, double duration) {
        int completed = (duration > 0 && position / duration >= 0.9) ? 1 : 0;
        SQLiteDatabase db = getWritableDatabase();
        db.execSQL(
            "INSERT INTO watch_progress (media_id, position, duration, completed, last_watched) " +
            "VALUES (?, ?, ?, ?, strftime('%s','now')) " +
            "ON CONFLICT(media_id) DO UPDATE SET " +
            "  position = excluded.position," +
            "  duration = excluded.duration," +
            "  completed = excluded.completed," +
            "  last_watched = excluded.last_watched",
            new Object[]{mediaId, position, duration, completed});
    }

    public JSONArray getContinueWatching() {
        SQLiteDatabase db = getReadableDatabase();
        JSONArray arr = new JSONArray();
        Cursor c = db.rawQuery(
            "SELECT m.*, wp.position, wp.duration, wp.completed, wp.last_watched " +
            "FROM media m INNER JOIN watch_progress wp ON m.id = wp.media_id " +
            "WHERE wp.completed = 0 AND wp.position > 30 " +
            "ORDER BY wp.last_watched DESC LIMIT 20", null);
        try { while (c.moveToNext()) arr.put(cursorToJson(c)); } finally { c.close(); }
        return arr;
    }

    // ── Stats ─────────────────────────────────────────────────────────────────
    public JSONObject getStats() {
        SQLiteDatabase db = getReadableDatabase();
        try {
            int total      = queryInt(db, "SELECT COUNT(*) FROM media");
            int watched    = queryInt(db, "SELECT COUNT(*) FROM watch_progress WHERE completed=1");
            int inProgress = queryInt(db,
                "SELECT COUNT(*) FROM watch_progress WHERE completed=0 AND position>30");
            int favorites  = queryInt(db, "SELECT COUNT(*) FROM media WHERE favorite=1");
            int mins       = queryInt(db,
                "SELECT COALESCE(SUM(m.runtime),0) FROM media m " +
                "INNER JOIN watch_progress wp ON m.id=wp.media_id WHERE wp.completed=1");

            // Genre breakdown (top 5)
            JSONArray topGenres = new JSONArray();
            Cursor gc = db.rawQuery(
                "SELECT genres FROM media WHERE genres IS NOT NULL", null);
            java.util.Map<String, Integer> gmap = new java.util.HashMap<>();
            try {
                while (gc.moveToNext()) {
                    String raw = gc.getString(0);
                    if (raw == null) continue;
                    try {
                        JSONArray ga = new JSONArray(raw);
                        for (int i = 0; i < ga.length(); i++) {
                            String g = ga.optString(i);
                            gmap.put(g, gmap.getOrDefault(g, 0) + 1);
                        }
                    } catch (JSONException ignored) {}
                }
            } finally { gc.close(); }
            List<java.util.Map.Entry<String,Integer>> entries =
                new ArrayList<>(gmap.entrySet());
            entries.sort((a, b) -> b.getValue() - a.getValue());
            for (int i = 0; i < Math.min(5, entries.size()); i++) {
                JSONObject o = new JSONObject();
                o.put("name",  entries.get(i).getKey());
                o.put("count", entries.get(i).getValue());
                topGenres.put(o);
            }

            JSONObject stats = new JSONObject();
            stats.put("total",        total);
            stats.put("watched",      watched);
            stats.put("inProgress",   inProgress);
            stats.put("favorites",    favorites);
            stats.put("hoursWatched", Math.round(mins / 60.0));
            stats.put("topGenres",    topGenres);
            return stats;
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    public JSONObject getSurprise(Integer maxRuntime, Double minRating, String genre) {
        SQLiteDatabase db = getReadableDatabase();
        StringBuilder sql = new StringBuilder(
            "SELECT m.* FROM media m " +
            "LEFT JOIN watch_progress wp ON m.id = wp.media_id " +
            "WHERE (wp.completed IS NULL OR wp.completed = 0) " +
            "  AND (wp.position  IS NULL OR wp.position  < 30)");
        List<String> args = new ArrayList<>();
        if (maxRuntime != null) { sql.append(" AND (m.runtime IS NULL OR m.runtime <= ?)"); args.add(String.valueOf(maxRuntime)); }
        if (minRating  != null) { sql.append(" AND (m.rating  IS NULL OR m.rating  >= ?)"); args.add(String.valueOf(minRating));  }
        if (genre      != null && !genre.isEmpty()) { sql.append(" AND m.genres LIKE ?"); args.add("%" + genre + "%"); }
        sql.append(" ORDER BY RANDOM() LIMIT 1");
        Cursor c = db.rawQuery(sql.toString(), args.toArray(new String[0]));
        try { return c.moveToFirst() ? cursorToJson(c) : null; } finally { c.close(); }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    private static int queryInt(SQLiteDatabase db, String sql) {
        Cursor c = db.rawQuery(sql, null);
        try { return c.moveToFirst() ? c.getInt(0) : 0; } finally { c.close(); }
    }

    static JSONObject cursorToJson(Cursor c) {
        JSONObject o = new JSONObject();
        try {
            for (int i = 0; i < c.getColumnCount(); i++) {
                String col = c.getColumnName(i);
                if (c.isNull(i)) { o.put(col, JSONObject.NULL); continue; }
                switch (c.getType(i)) {
                    case Cursor.FIELD_TYPE_INTEGER: o.put(col, c.getLong(i));   break;
                    case Cursor.FIELD_TYPE_FLOAT:   o.put(col, c.getDouble(i)); break;
                    default:                        o.put(col, c.getString(i)); break;
                }
            }
        } catch (JSONException ignored) {}
        return o;
    }
}
