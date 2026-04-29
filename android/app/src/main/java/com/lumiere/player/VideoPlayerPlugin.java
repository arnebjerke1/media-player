package com.lumiere.player;

import android.app.Activity;
import android.content.Intent;

import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Capacitor plugin that launches the native ExoPlayer activity.
 * Handles H.265/HEVC, MKV, AC3, EAC3 and all other codecs supported by the
 * Android media framework — no browser codec restrictions.
 */
@CapacitorPlugin(name = "VideoPlayer")
public class VideoPlayerPlugin extends Plugin {

    private ActivityResultLauncher<Intent> playerLauncher;

    @Override
    public void load() {
        playerLauncher = getActivity().registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> handlePlayerResult(getSavedCall(), result)
        );
    }

    /**
     * Play a video from a URL in a fullscreen native ExoPlayer.
     *
     * Call options:
     *   url      {string}  – HTTP URL of the stream (e.g. http://localhost:3000/api/stream/5)
     *   title    {string}  – Display title
     *   position {number}  – Resume position in seconds (default 0)
     *   mediaId  {number}  – Database media ID (echoed back in result for progress saving)
     *
     * Resolves with { position, duration } (both in seconds) when the player is closed.
     */
    @PluginMethod
    public void play(PluginCall call) {
        saveCall(call);

        String url     = call.getString("url",   "");
        String title   = call.getString("title", "");
        double posSec  = call.getDouble("position", 0.0);
        int    mediaId = call.getInt("mediaId", 0);

        if (url == null || url.isEmpty()) {
            call.reject("MISSING_URL");
            return;
        }

        Intent intent = new Intent(getContext(), PlayerActivity.class);
        intent.putExtra(PlayerActivity.EXTRA_URL,      url);
        intent.putExtra(PlayerActivity.EXTRA_TITLE,    title);
        intent.putExtra(PlayerActivity.EXTRA_POSITION, (long)(posSec * 1000L));
        intent.putExtra(PlayerActivity.EXTRA_MEDIA_ID, mediaId);

        playerLauncher.launch(intent);
    }

    private void handlePlayerResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        freeSavedCall();

        JSObject ret = new JSObject();
        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            Intent data = result.getData();
            ret.put("position", data.getLongExtra(PlayerActivity.RESULT_POSITION, 0L) / 1000.0);
            ret.put("duration", data.getLongExtra(PlayerActivity.RESULT_DURATION, 0L) / 1000.0);
            ret.put("mediaId",  data.getIntExtra(PlayerActivity.RESULT_MEDIA_ID,  0));
        }
        call.resolve(ret);
    }
}
