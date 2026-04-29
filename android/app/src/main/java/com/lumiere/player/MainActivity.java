package com.lumiere.player;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Register custom plugins before the Capacitor bridge is initialised.
        registerPlugin(FolderPickerPlugin.class);
        registerPlugin(VideoPlayerPlugin.class);

        super.onCreate(savedInstanceState);
        // Disable the default requirement for a user gesture before media can play.
        bridge.getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
    }
}
