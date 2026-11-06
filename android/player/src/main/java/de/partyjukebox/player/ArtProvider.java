package de.partyjukebox.player;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

/**
 * Cover für Android Auto: Android Auto lädt Bilder nur über content://-Adressen.
 * Lädt das Cover von der Jukebox (Add-on-Proxy, zuhause oder über Nabu Casa) und speichert es im Cache.
 */
public class ArtProvider extends ContentProvider {
    static final String AUTH = BuildConfig.APPLICATION_ID + ".art";

    static Uri uri(String httpUrl) {
        if (httpUrl == null || httpUrl.isEmpty()) return null;
        return new Uri.Builder().scheme("content").authority(AUTH).appendPath("img").appendQueryParameter("u", httpUrl).build();
    }

    @Override public boolean onCreate() { return true; }

    /** Symbol für den Knopf "Umschalten" in Android Auto (content://<app>.art/icon/toggle) */
    static Uri icon(String name) {
        return new Uri.Builder().scheme("content").authority(AUTH).appendPath("icon").appendPath(name).build();
    }

    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if ("icon".equals(uri.getPathSegments().isEmpty() ? "" : uri.getPathSegments().get(0))) return iconFile();
        String u = uri.getQueryParameter("u");
        // nur Bilder der eigenen Jukebox
        if (u == null || !(u.startsWith("https://") || (!Endpoint.LOCAL.isEmpty() && u.startsWith(Endpoint.LOCAL)))) throw new FileNotFoundException();
        File dir = new File(getContext().getCacheDir(), "art");
        if (!dir.exists()) dir.mkdirs();
        File f = new File(dir, hash(u.replaceFirst("^https?://[^/]+(/api/hassio_ingress/[^/]+)?/", "")) + ".img");
        if (f.exists() && !complete(f)) f.delete();   // halb geladenes Cover von früher wegwerfen
        if (!f.exists() || f.length() == 0) {
            Exception last = null;
            for (int tries = 0; tries < 2 && !f.exists(); tries++) {   // ein zweiter Versuch bei Abbruch (Funkloch)
                File tmp = new File(dir, f.getName() + ".tmp");
                try {
                    HttpURLConnection c = (HttpURLConnection) new URL(u).openConnection();
                    c.setConnectTimeout(6000); c.setReadTimeout(8000);
                    if (u.startsWith(Endpoint.base)) { String ck = Endpoint.cookie(); if (!ck.isEmpty()) c.setRequestProperty("Cookie", ck); }
                    if (c.getResponseCode() != 200) { c.disconnect(); throw new FileNotFoundException("HTTP " + c.getResponseCode()); }
                    long want = c.getContentLengthLong();
                    InputStream in = c.getInputStream();
                    FileOutputStream os = new FileOutputStream(tmp);
                    byte[] b = new byte[16384]; int n;
                    while ((n = in.read(b)) > 0) os.write(b, 0, n);
                    os.close(); in.close(); c.disconnect();
                    // Lernkarte: bricht die Verbindung mitten im Bild ab, endet read() manchmal ohne Fehler.
                    // Dann wäre nur die obere Hälfte gespeichert – darum Länge und Bild-Ende prüfen.
                    if ((want > 0 && tmp.length() != want) || !complete(tmp)) throw new java.io.IOException("Cover unvollständig");
                    if (!tmp.renameTo(f)) throw new FileNotFoundException();
                } catch (FileNotFoundException e) { tmp.delete(); throw e; }
                catch (Exception e) { tmp.delete(); last = e; }
            }
            if (!f.exists()) throw new FileNotFoundException(String.valueOf(last));
        }
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    /** res/raw/ic_toggle.png einmal in den Cache kopieren und von dort ausliefern */
    private ParcelFileDescriptor iconFile() throws FileNotFoundException {
        File f = new File(getContext().getCacheDir(), "ic_toggle_v1.png");
        if (!f.exists() || f.length() == 0) {
            try (InputStream in = getContext().getResources().openRawResource(R.raw.ic_toggle);
                 FileOutputStream os = new FileOutputStream(f)) {
                byte[] b = new byte[8192]; int n;
                while ((n = in.read(b)) > 0) os.write(b, 0, n);
            } catch (Exception e) { throw new FileNotFoundException(e.toString()); }
        }
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    /** Ist das Bild vollständig? JPEG endet mit FF D9, PNG mit dem IEND-Block; andere Formate gelten als gut. */
    private static boolean complete(File f) {
        long len = f.length();
        if (len < 16) return false;
        try (java.io.RandomAccessFile r = new java.io.RandomAccessFile(f, "r")) {
            byte[] head = new byte[4]; r.readFully(head);
            byte[] tail = new byte[(int) Math.min(32, len)]; r.seek(len - tail.length); r.readFully(tail);
            if ((head[0] & 0xff) == 0xFF && (head[1] & 0xff) == 0xD8) {
                for (int i = tail.length - 2; i >= 0; i--) if ((tail[i] & 0xff) == 0xFF && (tail[i + 1] & 0xff) == 0xD9) return true;
                return false;
            }
            if ((head[0] & 0xff) == 0x89 && head[1] == 'P' && head[2] == 'N' && head[3] == 'G')
                return new String(tail, "ISO-8859-1").contains("IEND");
            return true;
        } catch (Exception e) { return false; }
    }

    private static String hash(String s) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-1");
            StringBuilder sb = new StringBuilder();
            for (byte x : md.digest(s.getBytes("UTF-8"))) sb.append(String.format("%02x", x));
            return sb.toString();
        } catch (Exception e) { return String.valueOf(s.hashCode()); }
    }

    @Override public String getType(Uri uri) {
        return uri.getPathSegments().size() > 0 && "icon".equals(uri.getPathSegments().get(0)) ? "image/png" : "image/jpeg";
    }
    @Override public Cursor query(Uri u, String[] p, String s, String[] a, String o) { return null; }
    @Override public Uri insert(Uri u, ContentValues v) { return null; }
    @Override public int delete(Uri u, String s, String[] a) { return 0; }
    @Override public int update(Uri u, ContentValues v, String s, String[] a) { return 0; }
}
