package de.partyjukebox.tv;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.KeyEvent;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.TextView;

/** Einrichtung: Adresse eingeben, testen, speichern – komplett mit der Fernbedienung bedienbar. */
public class SetupActivity extends Activity {

    private EditText address;
    private TextView status;
    private CheckBox autostart;
    private Button btnTest;
    private Button btnSave;
    private boolean testing;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_setup);

        address = findViewById(R.id.address);
        status = findViewById(R.id.status);
        autostart = findViewById(R.id.autostart);
        btnTest = findViewById(R.id.btn_test);
        btnSave = findViewById(R.id.btn_save);
        Button btnCancel = findViewById(R.id.btn_cancel);
        TextView version = findViewById(R.id.version);

        String saved = ServerAddress.get(this);
        boolean configured = !saved.isEmpty();
        address.setText(configured ? saved : getString(R.string.setup_address_default));
        address.setSelection(address.getText().length());
        autostart.setChecked(ServerAddress.autostart(this));
        if (configured) btnCancel.setVisibility(View.VISIBLE);

        try {
            String v = getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            version.setText("Version " + v);
        } catch (Exception ignored) {
            version.setText("");
        }

        // "Fertig" auf der Bildschirmtastatur → weiter zu "Testen"
        address.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_DONE || actionId == EditorInfo.IME_ACTION_GO
                    || (event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER
                        && event.getAction() == KeyEvent.ACTION_DOWN)) {
                btnTest.requestFocus();
                return false; // Tastatur trotzdem schließen lassen
            }
            return false;
        });

        btnTest.setOnClickListener(v -> runTest());
        btnSave.setOnClickListener(v -> save());
        btnCancel.setOnClickListener(v -> {
            setResult(RESULT_CANCELED);
            finish();
        });
        autostart.setOnCheckedChangeListener((b, checked) -> {
            if (checked) askOverlayPermissionIfNeeded();
        });

        // Erster Start: Fokus auf "Testen" (Adresse ist vorbelegt), sonst auf "Speichern"
        (configured ? btnSave : btnTest).requestFocus();
    }

    private void runTest() {
        if (testing) return;
        final String base = ServerAddress.normalize(address.getText().toString());
        if (base.isEmpty()) {
            showStatus(getString(R.string.setup_empty), false);
            address.requestFocus();
            return;
        }
        address.setText(base);
        address.setSelection(base.length());
        testing = true;
        status.setTextColor(color(R.color.pj_text_dim));
        status.setText(R.string.setup_testing);
        new Thread(() -> {
            final ServerAddress.Result r = ServerAddress.test(base);
            runOnUiThread(() -> {
                testing = false;
                if (isFinishing()) return;
                showStatus(r.message, r.ok);
                if (r.ok) btnSave.requestFocus();
            });
        }, "pj-test").start();
    }

    private void showStatus(String msg, boolean ok) {
        status.setTextColor(color(ok ? R.color.pj_ok : R.color.pj_err));
        status.setText(msg);
    }

    /** Farbe aus den Ressourcen (getColor(int) gibt es erst ab Android 6). */
    @SuppressWarnings("deprecation")
    private int color(int id) {
        return Build.VERSION.SDK_INT >= 23 ? getColor(id) : getResources().getColor(id);
    }

    private void save() {
        String base = ServerAddress.normalize(address.getText().toString());
        if (base.isEmpty()) {
            showStatus(getString(R.string.setup_empty), false);
            address.requestFocus();
            return;
        }
        ServerAddress.prefs(this).edit()
                .putString(ServerAddress.KEY_ADDRESS, base)
                .putBoolean(ServerAddress.KEY_AUTOSTART, autostart.isChecked())
                .apply();
        setResult(RESULT_OK);
        finish();
    }

    /**
     * Ab Android 10 dürfen Apps nach dem Booten nur mit der Berechtigung
     * "Über anderen Apps einblenden" selbst starten. Einstellungsseite öffnen, falls vorhanden.
     */
    private void askOverlayPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return;
        if (Settings.canDrawOverlays(this)) return;
        showStatus(getString(R.string.setup_overlay_hint), false);
        try {
            startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + getPackageName())));
        } catch (ActivityNotFoundException | SecurityException e) {
            // Viele TV-Boxen haben diese Seite nicht – der Hinweis (ADB-Befehl) bleibt stehen
        }
    }
}
