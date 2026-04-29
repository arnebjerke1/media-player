package com.lumiere.player;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
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

        // Full-screen, keep screen on
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN |
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
            WindowManager.LayoutParams.FLAG_FULLSCREEN |
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
        );

        url     = getIntent().getStringExtra(EXTRA_URL);
        mediaId = getIntent().getIntExtra(EXTRA_MEDIA_ID, 0);
        String title   = getIntent().getStringExtra(EXTRA_TITLE);
        long   startMs = getIntent().getLongExtra(EXTRA_POSITION, 0L);

        buildLayout(title);
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
            finishWithResult();
            player.release();
            player = null;
        }
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        finishWithResult();
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

        // Tap anywhere on the video to toggle controls
        playerView.setOnClickListener(v -> toggleControls());
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

        FrameLayout.LayoutParams topLp = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT);
        topLp.gravity = Gravity.TOP;
        overlay.addView(topBar, topLp);

        btnBack.setOnClickListener(v -> finishWithResult());

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
        controlsOverlay.setVisibility(visible ? View.VISIBLE : View.INVISIBLE);
        if (visible) scheduleHide();
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
