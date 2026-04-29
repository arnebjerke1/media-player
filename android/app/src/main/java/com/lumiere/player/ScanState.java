package com.lumiere.player;

import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/** Thread-safe container for the progress of a background library scan. */
public final class ScanState {

    private ScanState() {}

    public static final AtomicBoolean       inProgress = new AtomicBoolean(false);
    public static final AtomicInteger       total      = new AtomicInteger(0);
    public static final AtomicInteger       processed  = new AtomicInteger(0);
    public static final AtomicReference<String> current = new AtomicReference<>("");

    public static void reset(int totalFiles) {
        total.set(totalFiles);
        processed.set(0);
        current.set("");
        inProgress.set(true);
    }

    public static void finish() {
        inProgress.set(false);
        current.set("");
    }
}
