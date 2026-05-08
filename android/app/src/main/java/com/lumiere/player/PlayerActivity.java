package com.lumiere.player;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.GestureDetector;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.SeekBar;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.annotation.OptIn;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;

/**
 * Fullscreen native video player using ExoPlayer (AndroidX Media3).
 * Supports MKV, H.265/HEVC, AC3, EAC3, and all other codecs handled by
 * the Android hardware/software decoders — no browser codec restrictions.
 *
 * UI style: minimal, VLC-inspired. Tap anywhere to show/hide controls.
 * Controls auto-hide after 3.5 s during playback.
 */
@OptIn(markerClass = UnstableApi.class)
public class PlayerActivity extends Activity {

    // ── Intent / Result extras ────────────────────────────────────────────────
    public static final String EXTRA_URL       = "url";
    public static final String EXTRA_TITLE     = "title";
    public static final String EXTRA_POSITION  = "position";  // ms
    public static final String EXTRA_MEDIA_ID  = "mediaId";
    public static final String RESULT_POSITION = "position";  // ms
    public static final String RESULT_DURATION = "duration";  // ms
    public static final String RESULT_MEDIA_ID = "mediaId";

    private static final long CONTROLS_HIDE_DELAY = 3_500L;
    private static final long SEEK_STEP_MS        = 10_000L;  // ±10 s

    // ── Fields ────────────────────────────────────────────────────────────────
    private ExoPlayer   player;
    private PlayerView  playerView;
    private View        controlsOverlay;
    private SeekBar     seekBar;
    private TextView    timeText;
    private ImageButton btnPlayPause;
    private boolean     controlsVisible = true;
    private boolean     isSeeking       = false;
    private int         mediaId;
    private String      url;

    private boolean     isLocked        = false;
    private ImageButton btnLock;
    private GestureDetector gestureDetector;
    private AudioManager audioManager;

    private final Handler handler    = new Handler(Looper.getMainLooper());
    private final Runnable hideCtrl  = () -> setControlsVisible(false);
    private final Runnable updateSeek = new Runnable() {
        @Override public void run() {
            updateSeekBar();
            handler.postDelayed(this, 500);
        }
    };

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        requestWindowFeature(Window.FEATURE_NO_TITLE);
        // Keep screen on; immersive mode (hides both status bar AND nav bar) is
        // applied via hideSystemUI() so it can be re-applied on window focus changes.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        hideSystemUI();

        audioManager = (AudioManager) getSystemService(AUDIO_SERVICE);

        url     = getIntent().getStringExtra(EXTRA_URL);
        mediaId = getIntent().getIntExtra(EXTRA_MEDIA_ID, 0);
        String title   = getIntent().getStringExtra(EXTRA_TITLE);
        long   startMs = getIntent().getLongExtra(EXTRA_POSITION, 0L);

        buildLayout(title);
        setupGestures();
        setupPlayer(url, startMs);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (player != null) player.pause();
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (player != null) {
            player.release();
            player = null;
        }
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (isLocked) return;   // swallow back press when locked
        finishWithResult();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // Re-apply immersive mode whenever the window regains focus (e.g. after a dialog).
        if (hasFocus) hideSystemUI();
    }

    // Hides both the status bar and the navigation bar using immersive sticky mode.
    // Uses WindowInsetsController on API 30+ and the legacy flags on older devices.
    @SuppressWarnings("deprecation")
    private void hideSystemUI() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController ctrl = getWindow().getInsetsController();
            if (ctrl != null) {
                ctrl.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                ctrl.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            );
        }
    }

    // Swipe up/down on left half → brightness; right half → volume.
    // Single tap → toggle controls.
    private void setupGestures() {
        gestureDetector = new GestureDetector(this, new GestureDetector.SimpleOnGestureListener() {
            private static final int SWIPE_THRESHOLD = 20;

            @Override
            public boolean onSingleTapConfirmed(MotionEvent e) {
                if (isLocked) {
                    // When locked, a tap shows just the lock icon briefly
                    setControlsVisible(true);
                } else {
                    toggleControls();
                }
                return true;
            }

            @Override
            public boolean onScroll(MotionEvent e1, MotionEvent e2, float distX, float distY) {
                if (isLocked || e1 == null) return false;
                if (Math.abs(distY) < SWIPE_THRESHOLD) return false;

                int screenWidth = getWindow().getDecorView().getWidth();
                boolean leftSide = e1.getX() < screenWidth / 2f;

                if (leftSide) {
                    adjustBrightness(distY > 0 ? 0.05f : -0.05f);
                } else {
                    adjustVolume(distY > 0 ? 1 : -1);
                }
                return true;
            }
        });
    }

    private void toggleLock() {
        isLocked = !isLocked;
        btnLock.setImageResource(isLocked
            ? android.R.drawable.ic_lock_lock
            : android.R.drawable.ic_lock_idle_lock);
        if (isLocked) {
            // Hide everything except the lock button itself
            handler.removeCallbacks(hideCtrl);
            // Keep overlay visible so lock button stays tappable, but hide bottom bar
            controlsOverlay.setVisibility(View.VISIBLE);
        } else {
            scheduleHide();
        }
    }

    private void adjustVolume(int direction) {
        audioManager.adjustStreamVolume(
            AudioManager.STREAM_MUSIC,
            direction > 0 ? AudioManager.ADJUST_RAISE : AudioManager.ADJUST_LOWER,
            AudioManager.FLAG_SHOW_UI
        );
    }

    private void adjustBrightness(float delta) {
        WindowManager.LayoutParams lp = getWindow().getAttributes();
        float current = lp.screenBrightness < 0 ? 0.5f : lp.screenBrightness;
        lp.screenBrightness = Math.max(0.01f, Math.min(1.0f, current + delta));
        getWindow().setAttributes(lp);
    }

    // ── Player setup ──────────────────────────────────────────────────────────
    private void setupPlayer(String videoUrl, long startMs) {
        player = new ExoPlayer.Builder(this).build();
        playerView.setPlayer(player);
        playerView.setUseController(false);   // we draw our own controls

        MediaItem item = MediaItem.fromUri(videoUrl);
        player.setMediaItem(item);
        player.prepare();
        if (startMs > 0) player.seekTo(startMs);
        player.setPlayWhenReady(true);

        player.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int state) {
                updatePlayPauseIcon();
                if (state == Player.STATE_ENDED) {
                    finishWithResult();
                }
            }
            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                updatePlayPauseIcon();
                scheduleHide();
            }
        });

        handler.post(updateSeek);
    }

    // ── Build UI (programmatic, no XML required) ───────────────────────────────
    @SuppressLint("ClickableViewAccessibility")
    private void buildLayout(String title) {
        // Root: black frame
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        setContentView(root, new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT));

        // ExoPlayer surface
        playerView = new PlayerView(this);
        playerView.setResizeMode(androidx.media3.ui.AspectRatioFrameLayout.RESIZE_MODE_FIT);
        root.addView(playerView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT));

        // Controls overlay (transparent, sits above video)
        controlsOverlay = buildControlsOverlay(root, title);

        // Touch handling is set up in setupGestures() after gestureDetector is created
        playerView.setOnTouchListener((v, event) -> {
            if (gestureDetector != null) gestureDetector.onTouchEvent(event);
            return true;
        });
    }

    @SuppressLint("SetTextI18n")
    private View buildControlsOverlay(FrameLayout root, String title) {
        FrameLayout overlay = new FrameLayout(this);
        root.addView(overlay, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT));

        int dp4  = dp(4);
        int dp8  = dp(8);
        int dp16 = dp(16);
        int dp48 = dp(48);

        // ── Top bar ───────────────────────────────────────────────────────────
        LinearLayout topBar = new LinearLayout(this);
        topBar.setOrientation(LinearLayout.HORIZONTAL);
        topBar.setGravity(Gravity.CENTER_VERTICAL);
        topBar.setPadding(dp8, dp(40), dp16, dp8);
        topBar.setBackgroundColor(Color.parseColor("#B3000000")); // 70% black

        ImageButton btnBack = new ImageButton(this);
        btnBack.setImageResource(android.R.drawable.ic_media_previous);
        btnBack.setBackground(null);
        btnBack.setColorFilter(Color.WHITE);
        btnBack.setPadding(dp8, dp8, dp8, dp8);
        LinearLayout.LayoutParams backLp = new LinearLayout.LayoutParams(dp48, dp48);
        topBar.addView(btnBack, backLp);

        TextView titleView = new TextView(this);
        titleView.setText(title != null ? title : "");
        titleView.setTextColor(Color.WHITE);
        titleView.setTextSize(15);
        titleView.setMaxLines(1);
        titleView.setEllipsize(android.text.TextUtils.TruncateAt.END);
        LinearLayout.LayoutParams titleLp = new LinearLayout.LayoutParams(
            0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        titleLp.setMarginStart(dp8);
        topBar.addView(titleView, titleLp);

        // Lock button — tap to lock/unlock all controls
        btnLock = new ImageButton(this);
        btnLock.setImageResource(android.R.drawable.ic_lock_idle_lock);
        btnLock.setBackground(null);
        btnLock.setColorFilter(Color.WHITE);
        btnLock.setPadding(dp8, dp8, dp8, dp8);
        topBar.addView(btnLock, new LinearLayout.LayoutParams(dp48, dp48));

        FrameLayout.LayoutParams topLp = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT);
        topLp.gravity = Gravity.TOP;
        overlay.addView(topBar, topLp);

        btnBack.setOnClickListener(v -> finishWithResult());
        btnLock.setOnClickListener(v -> toggleLock());

        // ── Bottom bar ────────────────────────────────────────────────────────
        LinearLayout bottomBar = new LinearLayout(this);
        bottomBar.setOrientation(LinearLayout.VERTICAL);
        bottomBar.setPadding(dp16, dp8, dp16, dp(24));
        bottomBar.setBackgroundColor(Color.parseColor("#B3000000")); // 70% black

        // Seek bar
        seekBar = new SeekBar(this);
        seekBar.getProgressDrawable().setColorFilter(Color.WHITE,
            android.graphics.PorterDuff.Mode.SRC_IN);
        seekBar.getThumb().setColorFilter(Color.WHITE,
            android.graphics.PorterDuff.Mode.SRC_IN);
        seekBar.setMax(1000);
        seekBar.setPadding(0, dp4, 0, dp4);
        bottomBar.addView(seekBar, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT));

        seekBar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override public void onProgressChanged(SeekBar sb, int progress, boolean fromUser) {
                if (fromUser && player != null && player.getDuration() > 0) {
                    long target = (long)(progress / 1000.0 * player.getDuration());
                    player.seekTo(target);
                    updateTimeText();
                }
            }
            @Override public void onStartTrackingTouch(SeekBar sb) { isSeeking = true; }
            @Override public void onStopTrackingTouch(SeekBar sb)  { isSeeking = false; scheduleHide(); }
        });

        // Controls row
        LinearLayout ctrlRow = new LinearLayout(this);
        ctrlRow.setOrientation(LinearLayout.HORIZONTAL);
        ctrlRow.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams rowLp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT);
        rowLp.topMargin = dp4;
        bottomBar.addView(ctrlRow, rowLp);

        // Skip back −10 s
        ImageButton btnBack10 = makeIconButton(android.R.drawable.ic_media_rew);
        btnBack10.setOnClickListener(v -> { if (player != null) player.seekTo(Math.max(0, player.getCurrentPosition() - SEEK_STEP_MS)); scheduleHide(); });
        ctrlRow.addView(btnBack10, new LinearLayout.LayoutParams(dp48, dp48));

        // Play / Pause
        btnPlayPause = makeIconButton(android.R.drawable.ic_media_pause);
        btnPlayPause.setOnClickListener(v -> {
            if (player == null) return;
            if (player.isPlaying()) player.pause(); else player.play();
            scheduleHide();
        });
        LinearLayout.LayoutParams ppLp = new LinearLayout.LayoutParams(dp(56), dp(56));
        ppLp.setMarginStart(dp16);
        ppLp.setMarginEnd(dp16);
        ctrlRow.addView(btnPlayPause, ppLp);

        // Skip forward +10 s
        ImageButton btnFwd10 = makeIconButton(android.R.drawable.ic_media_ff);
        btnFwd10.setOnClickListener(v -> {
            if (player != null) {
                long dur = player.getDuration();
                player.seekTo(dur > 0 ? Math.min(player.getCurrentPosition() + SEEK_STEP_MS, dur) : player.getCurrentPosition() + SEEK_STEP_MS);
            }
            scheduleHide();
        });
        ctrlRow.addView(btnFwd10, new LinearLayout.LayoutParams(dp48, dp48));

        // Spacer
        ctrlRow.addView(new View(this), new LinearLayout.LayoutParams(0, 1, 1f));

        // Time text
        timeText = new TextView(this);
        timeText.setTextColor(Color.WHITE);
        timeText.setTextSize(12);
        timeText.setText("0:00 / 0:00");
        ctrlRow.addView(timeText, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT));

        FrameLayout.LayoutParams botLp = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT);
        botLp.gravity = Gravity.BOTTOM;
        overlay.addView(bottomBar, botLp);

        return overlay;
    }

    private ImageButton makeIconButton(int iconRes) {
        ImageButton btn = new ImageButton(this);
        btn.setImageResource(iconRes);
        btn.setBackground(null);
        btn.setColorFilter(Color.WHITE);
        return btn;
    }

    // ── Controls visibility ───────────────────────────────────────────────────
    private void toggleControls() {
        setControlsVisible(!controlsVisible);
    }

    private void setControlsVisible(boolean visible) {
        controlsVisible = visible;
        if (isLocked) {
            // When locked only show the lock button; hide the rest after a moment
            controlsOverlay.setVisibility(View.VISIBLE);
            if (visible) handler.postDelayed(() -> {
                if (isLocked) controlsOverlay.setVisibility(View.INVISIBLE);
            }, 1500);
        } else {
            controlsOverlay.setVisibility(visible ? View.VISIBLE : View.INVISIBLE);
            if (visible) scheduleHide();
        }
    }

    private void scheduleHide() {
        handler.removeCallbacks(hideCtrl);
        if (player != null && player.isPlaying()) {
            handler.postDelayed(hideCtrl, CONTROLS_HIDE_DELAY);
        }
    }

    // ── Seek / time updates ───────────────────────────────────────────────────
    private void updateSeekBar() {
        if (player == null) return;
        updateTimeText();
        if (!isSeeking) {
            long dur = player.getDuration();
            long pos = player.getCurrentPosition();
            seekBar.setProgress(dur > 0 ? (int)(pos * 1000L / dur) : 0);
        }
    }

    private void updateTimeText() {
        if (player == null || timeText == null) return;
        long pos = player.getCurrentPosition();
        long dur = player.getDuration();
        timeText.setText(fmt(pos) + " / " + fmt(dur > 0 ? dur : 0));
    }

    private void updatePlayPauseIcon() {
        if (btnPlayPause == null) return;
        btnPlayPause.post(() -> {
            if (player != null && player.isPlaying()) {
                btnPlayPause.setImageResource(android.R.drawable.ic_media_pause);
            } else {
                btnPlayPause.setImageResource(android.R.drawable.ic_media_play);
            }
        });
    }

    // ── Result ────────────────────────────────────────────────────────────────
    private void finishWithResult() {
        long pos = player != null ? player.getCurrentPosition() : 0L;
        long dur = player != null && player.getDuration() > 0 ? player.getDuration() : 0L;

        Intent result = new Intent();
        result.putExtra(RESULT_POSITION, pos);
        result.putExtra(RESULT_DURATION, dur);
        result.putExtra(RESULT_MEDIA_ID, mediaId);
        setResult(Activity.RESULT_OK, result);
        finish();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    private int dp(int dp) {
        return Math.round(dp * getResources().getDisplayMetrics().density);
    }

    private static String fmt(long ms) {
        long s   = ms / 1000;
        long h   = s / 3600;
        long m   = (s % 3600) / 60;
        long sec = s % 60;
        if (h > 0) {
            return h + ":" + String.format("%02d", m) + ":" + String.format("%02d", sec);
        }
        return m + ":" + String.format("%02d", sec);
    }
}
