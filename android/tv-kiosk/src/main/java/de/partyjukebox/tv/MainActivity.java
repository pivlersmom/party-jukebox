package de.partyjukebox.tv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

/**
 * TV-Kiosk: zeigt <adresse>/tv.html im Vollbild, Bildschirm bleibt an.
 * Einstellungen: Menü-Taste, Zurück/OK lange drücken oder 3× schnell Zurück.
 */
public class MainActivity extends Activity {

    private static final int REQ_SETUP = 1;
    private static final long RETRY_MS = 10_000;
    private static final long LONG_PRESS_BACK_MS = 1_000;
    private static final long LONG_PRESS_OK_MS = 1_500;
    private static final long TAP_GAP_MS = 700;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private FrameLayout root;
    private WebView web;
    private TextView overlay;
    private String target = "";
    private boolean loadError; // wird nur vor eigenen Ladeversuchen zurückgesetzt
    private boolean setupOpen;

    // Tastenzustand für langes Drücken / Mehrfach-Zurück
    private long backDownAt;
    private boolean backLongFired;
    private int backTaps;
    private long okDownAt;
    private boolean okLongFired;

    private final Runnable retry = () -> {
        if (web != null && !target.isEmpty()) {
            loadError = false;
            web.loadUrl(target);
        }
    };

    private final Runnable backTapsDone = this::onBackTapsDone;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true); // nur in Debug-Builds
        }

        root = new FrameLayout(this);
        root.setBackgroundColor(0xFF05070C);
        overlay = new TextView(this);
        overlay.setBackgroundColor(0xF205070C);
        overlay.setTextColor(0xFFF2F5FB);
        overlay.setTextSize(24);
        overlay.setGravity(Gravity.CENTER);
        overlay.setPadding(64, 64, 64, 64);
        overlay.setVisibility(View.GONE);
        createWebView();
        root.addView(overlay, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        if (ServerAddress.get(this).isEmpty()) {
            openSetup();
        } else {
            load();
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void createWebView() {
        web = new WebView(this);
        web.setBackgroundColor(0xFF05070C);
        web.setFocusable(true);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new KioskClient());
        root.addView(web, 0, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private void load() {
        target = ServerAddress.get(this) + "/tv.html";
        handler.removeCallbacks(retry);
        loadError = false;
        web.loadUrl(target);
    }

    private void openSetup() {
        if (setupOpen) return;
        setupOpen = true;
        startActivityForResult(new Intent(this, SetupActivity.class), REQ_SETUP);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_SETUP) return;
        setupOpen = false;
        if (ServerAddress.get(this).isEmpty()) {
            finish(); // Einrichtung ohne Speichern verlassen → App beenden
        } else if (resultCode == RESULT_OK || target.isEmpty()) {
            load();
        }
    }

    /** Seite nicht erreichbar: Hinweis zeigen und in 10 s neu versuchen. */
    private void onLoadFailed(String reason) {
        loadError = true;
        String text = getString(R.string.kiosk_offline) + "\n\n" + target
                + (reason != null && !reason.isEmpty() ? "\n(" + reason + ")" : "")
                + "\n\n" + getString(R.string.kiosk_retry)
                + "\n\n" + getString(R.string.kiosk_settings_hint);
        overlay.setText(text);
        overlay.setVisibility(View.VISIBLE);
        handler.removeCallbacks(retry);
        handler.postDelayed(retry, RETRY_MS);
    }

    private class KioskClient extends WebViewClient {
        @Override
        public void onPageFinished(WebView view, String url) {
            if (!loadError) {
                overlay.setVisibility(View.GONE);
                handler.removeCallbacks(retry);
            }
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            // Ab Android 6: nur Fehler der Hauptseite zählen
            if (Build.VERSION.SDK_INT >= 23 && request.isForMainFrame()) {
                onLoadFailed(String.valueOf(error.getDescription()));
            }
        }

        @SuppressWarnings("deprecation")
        @Override
        public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
            // Android 5.x: wird nur für die Hauptseite gemeldet
            if (Build.VERSION.SDK_INT < 23) onLoadFailed(description);
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
            // z. B. 502, während das Add-on neu startet
            if (Build.VERSION.SDK_INT >= 23 && request.isForMainFrame() && response.getStatusCode() >= 400) {
                onLoadFailed("HTTP " + response.getStatusCode());
            }
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // WebView-Prozess abgestürzt/beendet: neue WebView anlegen statt App-Absturz
            if (view == web) {
                root.removeView(web);
                web.destroy();
                createWebView();
                if (!target.isEmpty()) {
                    handler.removeCallbacks(retry);
                    handler.postDelayed(retry, 1_000);
                }
            }
            return true;
        }
    }

    // ------------------------------------------------------------------ Tasten

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int code = e.getKeyCode();
        int action = e.getAction();

        if (code == KeyEvent.KEYCODE_MENU || code == KeyEvent.KEYCODE_SETTINGS) {
            if (action == KeyEvent.ACTION_UP) openSetup();
            return true;
        }

        if (code == KeyEvent.KEYCODE_BACK) {
            if (action == KeyEvent.ACTION_DOWN) {
                if (e.getRepeatCount() == 0) {
                    backDownAt = e.getEventTime();
                    backLongFired = false;
                } else if (!backLongFired && e.getEventTime() - backDownAt >= LONG_PRESS_BACK_MS) {
                    backLongFired = true;
                    resetBackTaps();
                    openSetup();
                }
            } else if (action == KeyEvent.ACTION_UP && !backLongFired && !e.isCanceled()) {
                backTaps++;
                handler.removeCallbacks(backTapsDone);
                if (backTaps >= 3) {
                    resetBackTaps();
                    openSetup();
                } else {
                    handler.postDelayed(backTapsDone, TAP_GAP_MS);
                }
            }
            return true;
        }

        if (code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER
                || code == KeyEvent.KEYCODE_NUMPAD_ENTER) {
            if (action == KeyEvent.ACTION_DOWN) {
                if (e.getRepeatCount() == 0) {
                    okDownAt = e.getEventTime();
                    okLongFired = false;
                } else if (!okLongFired && e.getEventTime() - okDownAt >= LONG_PRESS_OK_MS) {
                    okLongFired = true;
                    openSetup();
                }
                if (okLongFired) return true;
            } else if (action == KeyEvent.ACTION_UP && okLongFired) {
                okLongFired = false;
                return true;
            }
        }
        return super.dispatchKeyEvent(e);
    }

    private void onBackTapsDone() {
        int n = backTaps;
        resetBackTaps();
        if (n == 1) {
            Toast.makeText(this, R.string.kiosk_back_hint, Toast.LENGTH_SHORT).show();
        } else if (n == 2) {
            finish();
        }
    }

    private void resetBackTaps() {
        backTaps = 0;
        handler.removeCallbacks(backTapsDone);
    }

    // ------------------------------------------------------------------ Lebenszyklus

    @Override
    protected void onResume() {
        super.onResume();
        hideSystemUi();
        if (web != null) web.onResume();
    }

    @Override
    protected void onPause() {
        if (web != null) web.onPause();
        super.onPause();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUi();
    }

    @SuppressWarnings("deprecation")
    private void hideSystemUi() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (web != null) {
            root.removeView(web);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
