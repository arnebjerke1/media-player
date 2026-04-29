package com.lumiere.player;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Disable the default requirement for a user gesture before media can play.
        // Capacitor already sets this, but we explicitly override it here to ensure
        // audio always works in the WebView even on devices/versions where the default
        // may have changed.
        bridge.getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
    }
}
