package com.lumiere.player;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Java port of src/parser.js — parses media filenames into structured metadata.
 */
public final class FilenameParser {

    private FilenameParser() {}

    // ── Patterns ──────────────────────────────────────────────────────────────
    private static final Pattern TV_SXE  = Pattern.compile(
        "^(.*?)\\s*[Ss](\\d{1,2})[Ee](\\d{1,2})", Pattern.CASE_INSENSITIVE);
    private static final Pattern TV_NxNN = Pattern.compile(
        "^(.*?)\\s*(\\d{1,2})x(\\d{1,3})\\b",      Pattern.CASE_INSENSITIVE);

    private static final Pattern YEAR_PAT = Pattern.compile(
        "\\b(19[0-9]{2}|20[0-2][0-9])\\b");

    // Cutoff — anything from these tags onward is noise in movie filenames
    private static final Pattern CUTOFF = Pattern.compile(
        "\\b(19[0-9]{2}|20[0-2][0-9]|2160p|1080p|1080i|720p|720i|480p|480i" +
        "|4k|uhd|fhd|bluray|blu-ray|bdrip|brrip|webrip|web-dl|webdl|web|hdtv" +
        "|dvdrip|dvdscr|hdrip|dvd|x264|x265|h264|h265|hevc|xvid|divx|avc|vp9|av1" +
        "|aac|ac3|dts|truehd|atmos|flac|mp3|hdr|hdr10|dolby|dolbyvision|dv|hlg" +
        "|extended|theatrical|unrated|remastered|proper)\\b",
        Pattern.CASE_INSENSITIVE);

    private static final Pattern SEASON_DIR = Pattern.compile(
        "^[Ss]eason\\s*(\\d+)$|^[Ss](\\d{1,2})$", Pattern.CASE_INSENSITIVE);

    private static final Pattern EP_IN_FILENAME = Pattern.compile(
        "\\b(?:[Ee]p(?:isode)?\\s*\\.?\\s*(\\d+)|[Ee](\\d+)\\b|^(\\d+)\\b)");

    // Rotten Tomatoes (OMDB) minor words for title-case
    private static final java.util.Set<String> MINOR = new java.util.HashSet<>(java.util.Arrays.asList(
        "a","an","the","and","but","or","for","nor","so","yet",
        "at","by","in","of","on","to","up","as","is","it",
        "via","vs","with","from","into","over"));

    // ── Public result types ───────────────────────────────────────────────────
    public static class ParsedMovie {
        public final String  title;
        public final Integer year;
        ParsedMovie(String title, Integer year) { this.title = title; this.year = year; }
    }

    public static class ParsedTv {
        public final String showName;
        public final int    season;
        public final int    episode;
        ParsedTv(String showName, int season, int episode) {
            this.showName = showName; this.season = season; this.episode = episode;
        }
    }

    public static class Quality {
        public final String  quality;       // "4K", "1080p", "720p", "480p", or null
        public final boolean hdr;
        public final boolean dolbyVision;
        public final boolean atmos;
        Quality(String quality, boolean hdr, boolean dolbyVision, boolean atmos) {
            this.quality = quality; this.hdr = hdr;
            this.dolbyVision = dolbyVision; this.atmos = atmos;
        }
    }

    // ── parseFilename ─────────────────────────────────────────────────────────
    public static ParsedMovie parseFilename(String filename) {
        // Strip extension
        String name = filename.replaceAll("\\.[a-zA-Z0-9]{2,4}$", "");
        // Replace separators
        name = name.replace('.', ' ').replace('_', ' ');

        // Find year
        Matcher ym = YEAR_PAT.matcher(name);
        Integer year = null;
        if (ym.find()) year = Integer.parseInt(ym.group());

        // Find cutoff position
        int cutoff = name.length();
        if (year != null) {
            int yi = name.indexOf(String.valueOf(year));
            if (yi > 0) cutoff = Math.min(cutoff, yi);
        }
        Matcher cm = CUTOFF.matcher(name);
        if (cm.find() && cm.start() > 0) cutoff = Math.min(cutoff, cm.start());

        String title = name.substring(0, cutoff).trim()
                          .replaceAll("\\s+", " ")
                          .replaceAll("[-\\s]+$", "")
                          .trim();
        if (title.isEmpty()) title = name.trim();

        return new ParsedMovie(toTitleCase(title), year);
    }

    // ── parseTvFilename ───────────────────────────────────────────────────────
    /**
     * Returns a ParsedTv if the filename/filePath looks like a TV episode,
     * or null if it appears to be a standalone movie.
     *
     * @param filename  The filename (e.g. "Breaking.Bad.S01E01.mkv")
     * @param filePath  Full path — used to derive show/season from folder names
     *                  when the filename alone doesn't contain episode info.
     *                  May be null if unavailable.
     */
    public static ParsedTv parseTvFilename(String filename, String filePath) {
        String name = filename.replaceAll("\\.[a-zA-Z0-9]{2,4}$", "")
                              .replace('.', ' ').replace('_', ' ');

        // SxxExx
        Matcher m = TV_SXE.matcher(name);
        if (!m.find()) m = TV_NxNN.matcher(name);

        if (m.find()) {
            String raw = m.group(1).trim().replaceAll("[-\\s]+$", "").trim();
            if (raw.isEmpty() && filePath != null) raw = showNameFromPath(filePath);
            if (raw == null || raw.isEmpty()) return null;
            return new ParsedTv(toTitleCase(raw),
                                Integer.parseInt(m.group(2)),
                                Integer.parseInt(m.group(3)));
        }

        // Try folder structure: /Shows/Breaking Bad/Season 1/01 - Pilot.mkv
        if (filePath != null) return detectTvFromPath(filePath, filename);
        return null;
    }

    // ── detectQuality ─────────────────────────────────────────────────────────
    public static Quality detectQuality(String filename) {
        String f = filename.toLowerCase();
        String quality = null;
        if      (f.matches(".*\\b(2160p|4k|uhd)\\b.*"))  quality = "4K";
        else if (f.matches(".*\\b1080p\\b.*"))             quality = "1080p";
        else if (f.matches(".*\\b720p\\b.*"))              quality = "720p";
        else if (f.matches(".*\\b480p\\b.*"))              quality = "480p";

        boolean dv    = f.matches(".*\\b(dolby.?vision|dv|dovi)\\b.*");
        boolean hdr   = dv || f.matches(".*\\b(hdr10\\+|hdr10|hdr|hlg)\\b.*");
        boolean atmos = f.matches(".*\\b(atmos|truehd)\\b.*");
        return new Quality(quality, hdr, dv, atmos);
    }

    // ── Private helpers ───────────────────────────────────────────────────────
    private static String showNameFromPath(String filePath) {
        String[] parts = filePath.replace('\\', '/').split("/");
        for (int i = parts.length - 1; i >= 1; i--) {
            if (SEASON_DIR.matcher(parts[i]).matches()) {
                return i > 0 ? parts[i - 1] : null;
            }
        }
        return null;
    }

    private static ParsedTv detectTvFromPath(String filePath, String filename) {
        String[] parts = filePath.replace('\\', '/').split("/");
        String showName = null;
        int    season   = -1;
        for (int i = parts.length - 1; i >= 1; i--) {
            Matcher sm = SEASON_DIR.matcher(parts[i]);
            if (sm.matches()) {
                String g1 = sm.group(1), g2 = sm.group(2);
                season   = Integer.parseInt(g1 != null ? g1 : g2);
                showName = i > 0 ? parts[i - 1] : null;
                break;
            }
        }
        if (showName == null || season < 0) return null;

        String base = filename.replaceAll("\\.[a-zA-Z0-9]{2,4}$", "")
                              .replace('.', ' ').replace('_', ' ');
        Matcher em = EP_IN_FILENAME.matcher(base);
        if (!em.find()) return null;
        String eg = em.group(1) != null ? em.group(1)
                  : em.group(2) != null ? em.group(2)
                  : em.group(3);
        if (eg == null) return null;
        return new ParsedTv(toTitleCase(showName), season, Integer.parseInt(eg));
    }

    static String toTitleCase(String s) {
        if (s == null || s.isEmpty()) return s;
        String[] words = s.toLowerCase().split(" ");
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < words.length; i++) {
            String w = words[i];
            if (w.isEmpty()) continue;
            if (sb.length() > 0) sb.append(' ');
            if (i > 0 && MINOR.contains(w)) sb.append(w);
            else sb.append(Character.toUpperCase(w.charAt(0))).append(w.substring(1));
        }
        return sb.toString();
    }
}
