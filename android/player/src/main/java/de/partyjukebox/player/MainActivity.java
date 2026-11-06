package de.partyjukebox.player;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

public class MainActivity extends Activity {
    static WebView webView;
    private boolean resumedOnce = false;

    @Override protected void onCreate(Bundle b){
        super.onCreate(b);
        CrashLog.install(this);
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        // Lautstärketasten regeln (wenn die Seite es so will) die Medien-Lautstärke des Handys
        setVolumeControlStream(AudioManager.STREAM_MUSIC);
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, android.Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){
            ActivityCompat.requestPermissions(this,new String[]{android.Manifest.permission.POST_NOTIFICATIONS},1001);
        }
        // Media3-Dienst (Android Auto, Sperrbildschirm, Uhr) – läuft normal, nicht im Vordergrund
        try { startService(new Intent(this, JukeboxService.class)); }
        catch (Exception e) { android.util.Log.w("Jukebox", "Dienst-Start: " + e); }
        KeepAliveService.sync(this);  // Handy als Lautsprecher? Dann wach halten
        buildWebView();
    }

    /** WebView anlegen (auch neu, wenn Android den Browser-Prozess im Hintergrund beendet hat). */
    /*
     * Lernkarte: Startbild
     * Beim Öffnen liegt kurz das große Jukebox-Logo über der Seite (dunkler Hintergrund, Logo wächst sanft),
     * bis die Jukebox-Seite geladen ist (mindestens 3,5 s, höchstens 6 s) – dann blendet es weich aus.
     */
    private android.widget.FrameLayout root;
    private View splash;
    private long splashAt = 0;

    private void showSplash(){
        android.widget.FrameLayout sp = new android.widget.FrameLayout(this);
        sp.setBackgroundColor(0xFF0B0D14);
        android.widget.ImageView logo = new android.widget.ImageView(this);
        logo.setImageResource(R.mipmap.ic_launcher_foreground);
        int size = (int) (Math.min(getResources().getDisplayMetrics().widthPixels, getResources().getDisplayMetrics().heightPixels) * 0.75f);
        // wie das Logo oben links in der Jukebox: leuchtender Schein dreht sich (4 s), das Logo "pocht" (1,3 s)
        View glow = new GlowView(this);
        sp.addView(glow, new android.widget.FrameLayout.LayoutParams(size, size, android.view.Gravity.CENTER));
        sp.addView(logo, new android.widget.FrameLayout.LayoutParams(size, size, android.view.Gravity.CENTER));
        root.addView(sp, new android.widget.FrameLayout.LayoutParams(-1, -1));
        glow.setAlpha(0f);
        glow.animate().alpha(0.9f).setDuration(600).start();
        android.animation.ObjectAnimator spin = android.animation.ObjectAnimator.ofFloat(glow, "rotation", 0f, 360f);
        spin.setDuration(4000); spin.setRepeatCount(android.animation.ValueAnimator.INFINITE);
        spin.setInterpolator(new android.view.animation.LinearInterpolator()); spin.start();
        logo.setScaleX(0.8f); logo.setScaleY(0.8f); logo.setAlpha(0f);
        logo.animate().scaleX(1f).scaleY(1f).alpha(1f).setDuration(700).withEndAction(() -> {
            android.animation.PropertyValuesHolder sx = android.animation.PropertyValuesHolder.ofFloat("scaleX", 1f, 1.07f);
            android.animation.PropertyValuesHolder sy = android.animation.PropertyValuesHolder.ofFloat("scaleY", 1f, 1.07f);
            android.animation.ObjectAnimator beat = android.animation.ObjectAnimator.ofPropertyValuesHolder(logo, sx, sy);
            beat.setDuration(650); beat.setRepeatCount(android.animation.ValueAnimator.INFINITE);
            beat.setRepeatMode(android.animation.ValueAnimator.REVERSE);
            beat.setInterpolator(new android.view.animation.AccelerateDecelerateInterpolator()); beat.start();
        }).start();
        splash = sp; splashAt = System.currentTimeMillis();
        sp.postDelayed(this::hideSplash, 6000);   // spätestens nach 6 s weg
    }

    /** Farbiger Schein hinter dem Logo: Farbkreis (lila → blau), zur Mitte hin sichtbar, nach außen ausgeblendet */
    private static final class GlowView extends View {
        private final android.graphics.Paint paint = new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);
        GlowView(android.content.Context c) { super(c); setLayerType(LAYER_TYPE_SOFTWARE, null); }
        @Override protected void onSizeChanged(int w, int h, int ow, int oh) {
            float cx = w / 2f, cy = h / 2f, r = Math.min(w, h) / 2f;
            android.graphics.Shader sweep = new android.graphics.SweepGradient(cx, cy,
                new int[]{0x00E040FB, 0x8CE040FB, 0x8C29B6F6, 0x00E040FB}, null);
            android.graphics.Shader mask = new android.graphics.RadialGradient(cx, cy, r,
                new int[]{0xFF000000, 0xFF000000, 0x00000000}, new float[]{0f, 0.35f, 0.7f}, android.graphics.Shader.TileMode.CLAMP);
            paint.setShader(new android.graphics.ComposeShader(sweep, mask, android.graphics.PorterDuff.Mode.DST_IN));
        }
        @Override protected void onDraw(android.graphics.Canvas c) {
            c.drawCircle(getWidth() / 2f, getHeight() / 2f, Math.min(getWidth(), getHeight()) / 2f, paint);
        }
    }

    private void hideSplash(){
        final View sp = splash; if (sp == null) return;
        long wait = 3500 - (System.currentTimeMillis() - splashAt);   // mindestens 3,5 s zeigen
        if (wait > 0) { sp.postDelayed(this::hideSplash, wait); return; }
        splash = null;
        sp.animate().alpha(0f).setDuration(600).withEndAction(() -> { if (root != null) root.removeView(sp); }).start();
    }

    private void buildWebView(){
        webView=new WebView(this);
        if (root == null) { root = new android.widget.FrameLayout(this); setContentView(root); showSplash(); }
        root.addView(webView, 0, new android.widget.FrameLayout.LayoutParams(-1, -1));
        WebSettings s=webView.getSettings();
        s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        webView.addJavascriptInterface(new JukeboxBridge(),"AndroidMediaSession");
        webView.setWebViewClient(new WebViewClient(){
            @Override public void onPageFinished(WebView v, String url){ hideSplash(); }
            /* Android beendet im Hintergrund (z. B. beim Wechsel zu WhatsApp) gern den Browser-Prozess der WebView,
               um Speicher zu sparen. Ohne diese Behandlung stürzt dann die ganze App ab ("wird wiederholt beendet").
               Jetzt: alte WebView wegwerfen und die Seite neu laden. */
            @Override public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail){
                android.util.Log.w("Jukebox", "WebView-Prozess beendet (crash=" + (Build.VERSION.SDK_INT >= 26 && detail.didCrash()) + ") – neu laden");
                if (view == webView) {
                    try { ((android.view.ViewGroup) view.getParent()).removeView(view); } catch (Exception ignored) { }
                    try { view.destroy(); } catch (Exception ignored) { }
                    webView = null;
                    if (!isFinishing() && !isDestroyed()) buildWebView();
                } else {
                    try { view.destroy(); } catch (Exception ignored) { }
                }
                return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient(){
            @Override public void onPermissionRequest(PermissionRequest r){ r.grant(r.getResources()); }
        });
        loadJukebox(false);
    }

    /** Zuhause direkt, unterwegs über Nabu Casa (Ingress); ohne HA-Token einmal danach fragen. */
    private void loadJukebox(final boolean force){
        if (!Endpoint.configured(this)) { askSetup(); return; }   // erster Start: Adresse einrichten
        new Thread(() -> {
            final String r = Endpoint.resolve(this, force);
            runOnUiThread(() -> {
                if (webView == null) return;
                if ("local".equals(r) || "remote".equals(r)) {
                    String u = webView.getUrl();
                    if (force || u == null || !u.startsWith(Endpoint.base)) webView.loadUrl(Endpoint.jukeboxUrl());
                    MaClient.get(this).reset();
                } else if ("token".equals(r)) askToken();
                else offline();
            });
        }).start();
    }

    private void offline(){
        String html = "<html><body style='background:#0b0d14;color:#fff;font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:90vh;text-align:center'>"
            + "<h2>Jukebox nicht erreichbar</h2><p style='color:#9aa'>Weder zuhause noch unterwegs.</p>"
            + "<p style='color:#677;font-size:13px'>" + android.text.TextUtils.htmlEncode(Endpoint.lastError) + "</p>"
            + "<button onclick='AndroidMediaSession.retry()' style='font-size:18px;padding:14px 28px;border-radius:14px;border:0;background:#29b6f6;color:#fff'>Erneut versuchen</button>"
            + "<p><button onclick='AndroidMediaSession.openSetup()' style='font-size:15px;padding:10px 22px;border-radius:12px;border:1px solid #445;background:none;color:#9ab'>Adressen ändern</button></p></body></html>";
        webView.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
    }

    /*
     * Lernkarte: Einrichtung beim ersten Start
     * Ohne gespeicherte Adresse fragt die App einmal nach: Adresse zuhause (Home Assistant mit Port 8099
     * des Party-Jukebox-Add-ons), optional Adresse für unterwegs (z. B. Nabu Casa) und Home-Assistant-Token.
     * Alles bleibt nur auf diesem Handy.
     */
    void askSetup(){
        android.widget.LinearLayout box = new android.widget.LinearLayout(this);
        box.setOrientation(android.widget.LinearLayout.VERTICAL);
        int pad = (int) (20 * getResources().getDisplayMetrics().density);
        box.setPadding(pad, pad / 2, pad, 0);
        final android.widget.EditText home = new android.widget.EditText(this);
        home.setHint("Zuhause, z. B. 192.168.1.10"); home.setSingleLine(true);
        home.setText(Endpoint.LOCAL.replaceFirst("^http://", "").replaceFirst(":8099/$", ""));
        final android.widget.EditText rem = new android.widget.EditText(this);
        rem.setHint("Unterwegs (optional), z. B. abc123.ui.nabu.casa"); rem.setSingleLine(true);
        rem.setText(Endpoint.HA_REMOTE.replaceFirst("^https://", ""));
        final android.widget.EditText tok = new android.widget.EditText(this);
        tok.setHint("Home-Assistant-Token (nur für unterwegs)"); tok.setSingleLine(true);
        box.addView(home); box.addView(rem); box.addView(tok);
        new android.app.AlertDialog.Builder(this)
            .setTitle("Party-Jukebox einrichten")
            .setMessage("Adresse von Home Assistant mit dem Party-Jukebox-Add-on. Für unterwegs zusätzlich die externe "
                + "Adresse (z. B. Nabu Casa) und ein Token (Home Assistant → Profil → Sicherheit → Langlebige Zugriffstoken).")
            .setView(box)
            .setPositiveButton("Speichern", (d, w) -> {
                Endpoint.setAddresses(this, home.getText().toString(), rem.getText().toString());
                String t = tok.getText().toString().trim();
                if (!t.isEmpty()) Endpoint.setToken(this, t);
                loadJukebox(true);
            })
            .setNegativeButton("Abbrechen", (d, w) -> { if (!Endpoint.configured(this)) offline(); })
            .show();
    }

    private void askToken(){
        final android.widget.EditText in = new android.widget.EditText(this);
        in.setHint("Langlebiges Zugriffstoken");
        in.setSingleLine(true);
        new android.app.AlertDialog.Builder(this)
            .setTitle("Unterwegs über Nabu Casa")
            .setMessage((Endpoint.lastError.isEmpty() ? "" : "⚠ " + Endpoint.lastError + "\n\n")
                + "Zuhause ist die Jukebox gerade nicht erreichbar. Für unterwegs braucht die App ein Home-Assistant-Token "
                + "(Home Assistant → Profil → Sicherheit → Langlebige Zugriffstoken → Token erstellen).")
            .setView(in)
            .setPositiveButton("Speichern", (d, w) -> { Endpoint.setToken(this, in.getText().toString()); loadJukebox(true); })
            .setNegativeButton("Abbrechen", (d, w) -> offline())
            .show();
    }

    /* Zwischen WLAN und Mobilfunk gewechselt? Beim Zurückkehren in die App passende Adresse wählen */
    @Override protected void onResume(){
        super.onResume();
        MaPlayer.uiVisible = true; MaPlayer.poke();
        SendspinPlayer.wake(this, "App geöffnet");   // Handy-Lautsprecher aus dem Leerlauf holen
        if (resumedOnce) loadJukebox(false); else resumedOnce = true;
        if (PhonePlayer.enabled(this)) askBatteryExemption(false);
        Updater.check(this, false);   // neue Version? (höchstens alle 6 h)
    }

    /*
     * Lernkarte: Akku-Optimierung
     * Android (und Samsung im Energiesparmodus besonders) bremst Apps im Hintergrund: Netz und Rechenzeit
     * werden gekürzt → der Handy-Player bekommt die Musik nicht mehr rechtzeitig und verstummt.
     * Mit dieser Freigabe darf die App im Hintergrund normal weiterlaufen. Wir fragen einmal pro Version.
     */
    private void askBatteryExemption(boolean force) {
        if (Build.VERSION.SDK_INT < 23) return;
        try {
            android.os.PowerManager pm = (android.os.PowerManager) getSystemService(POWER_SERVICE);
            if (pm == null || pm.isIgnoringBatteryOptimizations(getPackageName())) return;
            android.content.SharedPreferences p = Endpoint.prefs(this);
            String k = "batt_ask_" + BuildConfig.VERSION_CODE;
            if (!force && p.getBoolean(k, false)) return;
            p.edit().putBoolean(k, true).apply();
            Intent i = new Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    android.net.Uri.parse("package:" + getPackageName()));
            startActivity(i);
        } catch (Exception e) { /* manche Geräte kennen den Dialog nicht */ }
    }

    /** App im Hintergrund → Player fragt seltener bei MA nach (Akku) */
    @Override protected void onPause(){
        MaPlayer.uiVisible = false;
        super.onPause();
    }

    /** Aufruf über partyjukebox://open (Jukebox-Logo auf der Gäste-Seite): zurück zur Jukebox. */
    @Override protected void onNewIntent(Intent intent){
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent != null && Intent.ACTION_VIEW.equals(intent.getAction()) && intent.getData() != null
                && "partyjukebox".equals(intent.getData().getScheme()) && webView != null) {
            String u = webView.getUrl();
            if (u == null || !u.contains("/jukebox.html")) webView.loadUrl(Endpoint.jukeboxUrl());
        }
    }

    @Override protected void onDestroy(){
        if (webView != null) {
            try { webView.destroy(); } catch (Exception ignored) { }
            webView = null;
        }
        super.onDestroy();
    }

    /** JavaScript in der Seite ausführen (sicher aus jedem Thread). */
    static void js(final String code){
        final WebView w=webView;
        if(w==null) return;
        w.post(new Runnable(){ public void run(){ w.evaluateJavascript(code,null); }});
    }

    /** Brücke Seite → App (window.AndroidMediaSession.*). Läuft in einem Hintergrund-Thread. */
    public class JukeboxBridge {
        // Die Seite meldet Änderungen → MaPlayer fragt sofort bei MA nach (Anzeige kommt von dort)
        @JavascriptInterface public void updateMetadata(String t,String a,String al,String art,String tok,boolean p){ MaPlayer.poke(); }
        @JavascriptInterface public void setPlaybackState(boolean p){ MaPlayer.poke(); }
        @JavascriptInterface public void updatePosition(long pos,long dur,boolean p){ }
        @JavascriptInterface public void setVolume(int v){ MaPlayer.pageVolume(v); }
        @JavascriptInterface public void setVolumeMode(boolean controllable){ MaPlayer.poke(); }
        @JavascriptInterface public void updateQueue(String q,int i){ }
        @JavascriptInterface public void setHaConfig(String url,String token,String pid){ }
        /** letzten Absturz der App (Stacktrace) abholen – leer, wenn keiner; wird danach gelöscht */
        @JavascriptInterface public String getLastCrash(){ return CrashLog.take(MainActivity.this); }
        /** Jukebox-Seite → Einstellungen: "Nach Update suchen" */
        /** Jukebox-Seite → Einstellungen: Adressen ändern / Auto-Einstellungen lesen und speichern */
        @JavascriptInterface public void openSetup(){ runOnUiThread(() -> askSetup()); }
        @JavascriptInterface public String getCarPrefs(){ return CarPrefs.get(MainActivity.this); }
        @JavascriptInterface public void setCarPrefs(String json){ CarPrefs.set(MainActivity.this, json); }
        @JavascriptInterface public void checkUpdate(){ runOnUiThread(() -> Updater.check(MainActivity.this, true)); }
        @JavascriptInterface public String getAppVersion(){ return BuildConfig.VERSION_NAME+" ("+BuildConfig.VERSION_CODE+")"; }
        /** Android Auto: gewählter Lautsprecher und Profil (Benutzer + Musikquellen) der Jukebox */
        @JavascriptInterface public void setAaContext(String json){
            try {
                org.json.JSONObject o = new org.json.JSONObject(json);
                android.content.SharedPreferences.Editor ed = Endpoint.prefs(MainActivity.this).edit();
                // Android Auto verbunden: dort gewählter Lautsprecher hat Vorrang (die Seite im Hintergrund kennt ihn evtl. noch nicht)
                MaPlayer mp = MaPlayer.instance;
                if (mp == null || !mp.getCarMode()) ed.putString("aa_pid", o.optString("pid", ""));
                ed.putString("aa_uid", o.optString("uid", ""));
                ed.putString("aa_user", o.optString("user", ""))
                    .putString("aa_providers", o.optJSONArray("providers") != null ? o.optJSONArray("providers").toString() : "[]")
                    .apply();
                MaPlayer.poke();
            } catch (Exception ignored) { }
        }
        @JavascriptInterface public void retry(){ runOnUiThread(() -> loadJukebox(true)); }
        /** Handy als Lautsprecher (Android Auto): Status, ein/aus, Einrichtung */
        /** App-Symbol als Bild für die Jukebox-Seite (oben links) – so zeigt jede App ihr eigenes Logo */
        @JavascriptInterface public String appIcon(){
            try {
                android.graphics.drawable.Drawable d = getPackageManager().getApplicationIcon(getPackageName());
                android.graphics.Bitmap b = android.graphics.Bitmap.createBitmap(144, 144, android.graphics.Bitmap.Config.ARGB_8888);
                android.graphics.Canvas c = new android.graphics.Canvas(b);
                d.setBounds(0, 0, 144, 144); d.draw(c);
                java.io.ByteArrayOutputStream o = new java.io.ByteArrayOutputStream();
                b.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, o);
                return "data:image/png;base64," + android.util.Base64.encodeToString(o.toByteArray(), android.util.Base64.NO_WRAP);
            } catch (Exception e) { return ""; }
        }
        @JavascriptInterface public String phonePlayerState(){
            return "{\"on\":" + PhonePlayer.enabled(MainActivity.this) + ",\"pid\":\"" + PhonePlayer.connectedId(MainActivity.this)
                + "\",\"fmt\":\"" + SendspinPlayer.format() + "\"}";
        }
        @JavascriptInterface public void setPhonePlayer(boolean on){
            PhonePlayer.setEnabled(MainActivity.this, on);
            if (on) runOnUiThread(() -> askBatteryExemption(true));
        }
        /** Name des Handy-Players in Music Assistant ändern (keine Anmeldung mehr nötig) */
        @JavascriptInterface public void openPhonePlayerSetup(){
            runOnUiThread(() -> {
                final android.widget.EditText in = new android.widget.EditText(MainActivity.this);
                in.setSingleLine(true);
                in.setText(SendspinPlayer.name(MainActivity.this));
                new android.app.AlertDialog.Builder(MainActivity.this)
                    .setTitle("Handy-Player")
                    .setMessage("Name in Music Assistant (z. B. „Mein Handy“). Eine Anmeldung ist nicht mehr nötig.")
                    .setView(in)
                    .setPositiveButton("Speichern", (d, w) -> SendspinPlayer.setName(MainActivity.this, in.getText().toString()))
                    .setNegativeButton("Abbrechen", null)
                    .show();
            });
        }
    }

    /** Lautstärketasten (App offen): Box bzw. Handy-Player über die Jukebox-Lautstärke regeln */
    @Override public boolean onKeyDown(int k,KeyEvent e){
        if(k==KeyEvent.KEYCODE_VOLUME_UP||k==KeyEvent.KEYCODE_VOLUME_DOWN){
            MaPlayer p=MaPlayer.instance;
            if(p!=null&&(p.isRemote()||p.isPhone())){
                int dir=k==KeyEvent.KEYCODE_VOLUME_UP?1:-1;
                // Dieses Handy spielt selbst (Handy-Player): Lautstärke direkt im Player ändern – MA bekommt sie gemeldet
                if(p.isPhone() && SendspinPlayer.isConnected()){ SendspinPlayer.changeVolume(dir*5); return true; }
                // Seite offen: über die Seite regeln (Regler bewegt sich sichtbar), sonst direkt
                if(webView!=null) js("window.onVolumeKey&&window.onVolumeKey("+dir+")"); else p.adjustVolume(dir);
                return true;
            }
        }
        return super.onKeyDown(k,e);
    }
    @Override public void onBackPressed(){ if(webView!=null && webView.canGoBack()) webView.goBack(); }
}
