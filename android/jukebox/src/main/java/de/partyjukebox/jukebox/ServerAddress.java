package de.partyjukebox.jukebox;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.ConnectException;
import java.net.HttpURLConnection;
import java.net.MalformedURLException;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/** Gespeicherte Add-on-Adresse und Verbindungstest (/config.js). */
final class ServerAddress {

    private static final String PREFS = "party_jukebox";
    static final String KEY_ADDRESS = "address";

    private ServerAddress() { }

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Gespeicherte Basisadresse (ohne Seite, ohne "/" am Ende) oder "" wenn noch nicht eingerichtet. */
    static String get(Context c) {
        return prefs(c).getString(KEY_ADDRESS, "");
    }

    /**
     * Eingabe vereinheitlichen: "http://" ergänzen, Seitennamen und "/" am Ende entfernen,
     * bei reiner Host-Angabe ohne Port :8099 anhängen.
     */
    static String normalize(String input) {
        if (input == null) return "";
        String s = input.trim().replace(" ", "");
        if (s.isEmpty()) return "";
        if (!s.toLowerCase(Locale.ROOT).matches("^https?://.*")) s = "http://" + s;
        s = stripSlashes(s);
        String lower = s.toLowerCase(Locale.ROOT);
        String[] pages = {"/jukebox.html", "/tv.html", "/party.html", "/start.html", "/index.html"};
        for (String p : pages) {
            if (lower.endsWith(p)) {
                s = stripSlashes(s.substring(0, s.length() - p.length()));
                break;
            }
        }
        Uri u = Uri.parse(s);
        String path = u.getPath();
        if ("http".equalsIgnoreCase(u.getScheme()) && u.getPort() == -1
                && (path == null || path.isEmpty()) && u.getHost() != null && !u.getHost().isEmpty()) {
            s = s + ":8099";
        }
        return s;
    }

    private static String stripSlashes(String s) {
        while (s.endsWith("/")) s = s.substring(0, s.length() - 1);
        return s;
    }

    /** Ergebnis eines Verbindungstests. */
    static final class Result {
        final boolean ok;
        final String message;

        Result(boolean ok, String message) {
            this.ok = ok;
            this.message = message;
        }
    }

    /** Prüft per HTTP, ob unter der Adresse das Party-Jukebox-Add-on antwortet. Nicht im UI-Thread aufrufen! */
    static Result test(String base) {
        HttpURLConnection c = null;
        try {
            URL url = new URL(base + "/config.js");
            c = (HttpURLConnection) url.openConnection();
            c.setConnectTimeout(5000);
            c.setReadTimeout(5000);
            c.setUseCaches(false);
            c.setInstanceFollowRedirects(true);
            int code = c.getResponseCode();
            if (code != 200) {
                return new Result(false, "Server antwortet, aber /config.js liefert HTTP " + code
                        + ". Ist das die Adresse des Party-Jukebox-Add-ons (Port 8099)?");
            }
            String body = readAll(c.getInputStream());
            int i = body.indexOf("window.PJ=");
            if (i < 0) {
                return new Result(false, "Antwort erhalten, aber das ist kein Party-Jukebox-Add-on.");
            }
            String name = "Party-Jukebox";
            boolean maToken = true;
            try {
                String json = body.substring(i + "window.PJ=".length()).trim();
                if (json.endsWith(";")) json = json.substring(0, json.length() - 1);
                JSONObject o = new JSONObject(json);
                name = o.optString("name", name);
                maToken = o.optBoolean("maToken", true);
            } catch (Exception ignored) {
                // Name ist nur Zierde – Test gilt trotzdem als erfolgreich
            }
            String msg = "✓ Verbunden mit „" + name + "“.";
            if (!maToken) {
                msg += "\nHinweis: Im Add-on ist noch kein Music-Assistant-Token eingetragen.";
            }
            return new Result(true, msg);
        } catch (UnknownHostException e) {
            String host = Uri.parse(base).getHost();
            return new Result(false, "Name „" + host + "“ nicht gefunden. Bitte die IP-Adresse von Home Assistant verwenden.");
        } catch (SocketTimeoutException e) {
            return new Result(false, "Zeitüberschreitung. Stimmt die Adresse, ist das Add-on gestartet?");
        } catch (ConnectException e) {
            return new Result(false, "Verbindung abgelehnt. Läuft das Add-on, ist der Port (8099) richtig?");
        } catch (MalformedURLException e) {
            return new Result(false, "Ungültige Adresse.");
        } catch (Exception e) {
            return new Result(false, "Fehler: " + e.getClass().getSimpleName()
                    + (e.getMessage() != null ? " – " + e.getMessage() : ""));
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static String readAll(InputStream in) throws java.io.IOException {
        try (InputStream is = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = is.read(buf)) > 0 && out.size() < 65536) out.write(buf, 0, n);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }
}
