package de.partyjukebox.jukebox;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
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

import java.util.Locale;

/**
 * Jukebox-App: zeigt <adresse>/jukebox.html.
 * Einstellungen: App-Symbol lange drücken → "Einstellungen", Zurück lange drücken,
 * Menü-Taste oder Schaltfläche im Verbindungsfehler-Hinweis.
 */
public class MainActivity extends Activity {

    static final String ACTION_SETTINGS = "de.partyjukebox.jukebox.EINSTELLUNGEN";
    private static final int REQ_SETUP = 1;
    private static final long RETRY_MS = 10_000;
    private static final long LONG_PRESS_BACK_MS = 800;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private FrameLayout root;
    private WebView web;
    private View offline;
    private TextView offlineDetail;
    private String target = "";
    private boolean loadError; // wird nur vor eigenen Ladeversuchen zurückgesetzt
    private boolean setupOpen;
    private long backDownAt;
    private boolean backLongFired;

    private final Runnable retry = this::reload;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        root = findViewById(R.id.root);
        offline = findViewById(R.id.offline);
        offlineDetail = findViewById(R.id.offline_detail);
        findViewById(R.id.btn_retry).setOnClickListener(v -> reload());
        findViewById(R.id.btn_settings).setOnClickListener(v -> openSetup());

        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true); // nur in Debug-Builds
        }
        createWebView();

        if (ServerAddress.get(this).isEmpty() || isSettingsIntent(getIntent())) {
            openSetup();
        } else {
            load();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (isSettingsIntent(intent)) openSetup();
        else if (isOpenIntent(intent) && !ServerAddress.get(this).isEmpty() && web != null) {
            // partyjukebox://open (Jukebox-Logo auf der Gäste-Seite): zurück zur Jukebox
            String u = web.getUrl();
            if (u == null || !u.contains("/jukebox.html")) load();
        }
    }

    private static boolean isOpenIntent(Intent i) {
        return i != null && Intent.ACTION_VIEW.equals(i.getAction()) && i.getData() != null
                && "partyjukebox".equals(i.getData().getScheme());
    }

    private static boolean isSettingsIntent(Intent i) {
        return i != null && ACTION_SETTINGS.equals(i.getAction());
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void createWebView() {
        web = new WebView(this);
        web.setBackgroundColor(0xFF0B0D14);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new JukeboxClient());
        // Optional für die Seite: window.PartyJukeboxApp.openSettings() öffnet die Einrichtung
        web.addJavascriptInterface(new Bridge(), "PartyJukeboxApp");
        root.addView(web, 0, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    /** Schnittstelle für jukebox.html (nur Einstellungen öffnen, sonst nichts). */
    public final class Bridge {
        @JavascriptInterface
        public void openSettings() {
            runOnUiThread(MainActivity.this::openSetup);
        }
    }

    private void load() {
        target = ServerAddress.get(this) + "/jukebox.html";
        reload();
    }

    private void reload() {
        handler.removeCallbacks(retry);
        if (web == null || target.isEmpty()) return;
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
            web.clearHistory();
            load();
        }
    }

    /** Seite nicht erreichbar: Hinweis mit Schaltflächen zeigen, alle 10 s neu versuchen. */
    private void onLoadFailed(String reason) {
        loadError = true;
        offlineDetail.setText(target + (reason != null && !reason.isEmpty() ? "\n(" + reason + ")" : ""));
        offline.setVisibility(View.VISIBLE);
        handler.removeCallbacks(retry);
        handler.postDelayed(retry, RETRY_MS);
    }

    private class JukeboxClient extends WebViewClient {
        @Override
        public void onPageFinished(WebView view, String url) {
            if (!loadError) {
                offline.setVisibility(View.GONE);
                handler.removeCallbacks(retry);
            }
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (Build.VERSION.SDK_INT >= 23 && request.isForMainFrame()) {
                onLoadFailed(String.valueOf(error.getDescription()));
            }
        }

        @SuppressWarnings("deprecation")
        @Override
        public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
            if (Build.VERSION.SDK_INT < 23) onLoadFailed(description);
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
            if (Build.VERSION.SDK_INT >= 23 && request.isForMainFrame() && response.getStatusCode() >= 400) {
                onLoadFailed("HTTP " + response.getStatusCode());
            }
        }

        @SuppressWarnings("deprecation")
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return openExternalIfForeign(url);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (!request.isForMainFrame()) return false;
            return openExternalIfForeign(request.getUrl().toString());
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // WebView-Prozess beendet: neue WebView statt App-Absturz
            if (view == web) {
                root.removeView(web);
                web.destroy();
                createWebView();
                handler.removeCallbacks(retry);
                handler.postDelayed(retry, 500);
            }
            return true;
        }
    }

    /** Links zu anderen Servern (z. B. Künstlerseiten) im Browser öffnen, eigene Seiten in der App. */
    private boolean openExternalIfForeign(String url) {
        if (url == null) return false;
        Uri u = Uri.parse(url);
        Uri base = Uri.parse(ServerAddress.get(this));
        String scheme = u.getScheme() != null ? u.getScheme().toLowerCase(Locale.ROOT) : "";
        if (scheme.isEmpty() || scheme.equals("about") || scheme.equals("data") || scheme.equals("blob")
                || scheme.equals("javascript") || scheme.equals("file")) {
            return false; // interne Seiten der WebView
        }
        boolean sameServer = (scheme.equals("http") || scheme.equals("https"))
                && u.getHost() != null && u.getHost().equalsIgnoreCase(base.getHost())
                && u.getPort() == base.getPort();
        if (sameServer) return false;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u));
        } catch (ActivityNotFoundException ignored) {
            // keine passende App – Link ignorieren
        }
        return true;
    }

    // ------------------------------------------------------------------ Tasten

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        int code = e.getKeyCode();
        int action = e.getAction();

        if (code == KeyEvent.KEYCODE_MENU) {
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
                    openSetup(); // Zurück lange gedrückt → Einstellungen
                }
            } else if (action == KeyEvent.ACTION_UP && !backLongFired && !e.isCanceled()) {
                if (web != null && web.canGoBack() && offline.getVisibility() != View.VISIBLE) {
                    web.goBack();
                } else {
                    finish();
                }
            }
            return true;
        }
        return super.dispatchKeyEvent(e);
    }

    // ------------------------------------------------------------------ Lebenszyklus

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onPause() {
        if (web != null) web.onPause();
        super.onPause();
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
