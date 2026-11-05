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
        if (!f.exists() || f.length() == 0) {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(u).openConnection();
                c.setConnectTimeout(6000); c.setReadTimeout(8000);
                if (u.startsWith(Endpoint.base)) { String ck = Endpoint.cookie(); if (!ck.isEmpty()) c.setRequestProperty("Cookie", ck); }
                InputStream in = c.getInputStream();
                File tmp = new File(dir, f.getName() + ".tmp");
                FileOutputStream os = new FileOutputStream(tmp);
                byte[] b = new byte[16384]; int n;
                while ((n = in.read(b)) > 0) os.write(b, 0, n);
                os.close(); in.close(); c.disconnect();
                if (!tmp.renameTo(f)) throw new FileNotFoundException();
            } catch (FileNotFoundException e) { throw e; }
            catch (Exception e) { throw new FileNotFoundException(e.toString()); }
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
