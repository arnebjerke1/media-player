package com.lumiere.player;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.net.Uri;

import androidx.documentfile.provider.DocumentFile;

import com.getcapacitor.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.List;

/**
 * Capacitor plugin for picking a media folder on Android using the Storage
 * Access Framework (ACTION_OPEN_DOCUMENT_TREE).  The resulting tree URI is
 * persisted across app restarts via takePersistableUriPermission so the user
 * only needs to grant access once.
 */
@CapacitorPlugin(name = "FolderPicker")
public class FolderPickerPlugin extends Plugin {

    private static final String PREFS_NAME    = "LumiereFolderPicker";
    private static final String PREF_TREE_URI = "treeUri";

    private static final String[] VIDEO_EXTENSIONS = {
        ".mp4", ".m4v", ".mkv", ".webm", ".mov", ".avi",
        ".ts",  ".mpg", ".mpeg", ".flv",  ".wmv", ".3gp",
        ".ogv", ".vob", ".m2ts", ".mts"
    };

    // ── pickFolder ─────────────────────────────────────────────────────────────

    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION |
            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
        );
        startActivityForResult(call, intent, "handleFolderResult");
    }

    @ActivityCallback
    private void handleFolderResult(PluginCall call, ActivityResult result) {
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("USER_CANCELLED");
            return;
        }

        Uri treeUri = result.getData().getData();
        if (treeUri == null) {
            call.reject("NO_URI");
            return;
        }

        // Take a persistable read permission so access survives app restarts.
        getContext().getContentResolver().takePersistableUriPermission(
            treeUri, Intent.FLAG_GRANT_READ_URI_PERMISSION
        );

        // Save the tree URI so getPersistedFolder() can restore it later.
        getContext()
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(PREF_TREE_URI, treeUri.toString())
            .apply();

        JSArray files = enumerateVideoFiles(treeUri);
        JSObject ret = new JSObject();
        ret.put("files", files);
        call.resolve(ret);
    }

    // ── getPersistedFolder ─────────────────────────────────────────────────────

    @PluginMethod
    public void getPersistedFolder(PluginCall call) {
        String uriStr = getContext()
            .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(PREF_TREE_URI, null);

        if (uriStr == null) {
            JSObject ret = new JSObject();
            ret.put("files", new JSArray());
            call.resolve(ret);
            return;
        }

        Uri treeUri = Uri.parse(uriStr);

        // Verify the persisted permission is still active.
        boolean hasPermission = false;
        List<UriPermission> perms = getContext().getContentResolver().getPersistedUriPermissions();
        for (UriPermission p : perms) {
            if (p.getUri().equals(treeUri) && p.isReadPermission()) {
                hasPermission = true;
                break;
            }
        }

        if (!hasPermission) {
            JSObject ret = new JSObject();
            ret.put("files", new JSArray());
            ret.put("permissionLapsed", true);
            call.resolve(ret);
            return;
        }

        JSArray files = enumerateVideoFiles(treeUri);
        JSObject ret = new JSObject();
        ret.put("files", files);
        call.resolve(ret);
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    private JSArray enumerateVideoFiles(Uri treeUri) {
        JSArray result = new JSArray();
        DocumentFile rootDir = DocumentFile.fromTreeUri(getContext(), treeUri);
        if (rootDir != null) {
            collectVideoFiles(rootDir, result);
        }
        return result;
    }

    private void collectVideoFiles(DocumentFile dir, JSArray result) {
        DocumentFile[] children = dir.listFiles();
        if (children == null) return;
        for (DocumentFile child : children) {
            if (child.isDirectory()) {
                collectVideoFiles(child, result);
            } else if (child.isFile()) {
                String name = child.getName();
                if (name != null && isVideoFile(name)) {
                    JSObject fileObj = new JSObject();
                    fileObj.put("name", name);
                    fileObj.put("uri", child.getUri().toString());
                    try {
                        result.put(fileObj);
                    } catch (Exception e) {
                        android.util.Log.w("FolderPicker", "Failed to add file to result: " + name, e);
                    }
                }
            }
        }
    }

    private boolean isVideoFile(String name) {
        String lower = name.toLowerCase();
        for (String ext : VIDEO_EXTENSIONS) {
            if (lower.endsWith(ext)) return true;
        }
        return false;
    }
}
