package de.partyjukebox.jukebox;

import android.app.Activity;
import android.content.Context;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;

/** Einrichtung: Adresse des Add-ons eingeben, testen, speichern. */
public class SetupActivity extends Activity {

    private EditText address;
    private TextView status;
    private boolean testing;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_setup);

        address = findViewById(R.id.address);
        status = findViewById(R.id.status);
        Button btnTest = findViewById(R.id.btn_test);
        Button btnSave = findViewById(R.id.btn_save);
        Button btnCancel = findViewById(R.id.btn_cancel);
        TextView version = findViewById(R.id.version);

        String saved = ServerAddress.get(this);
        boolean configured = !saved.isEmpty();
        address.setText(configured ? saved : getString(R.string.setup_address_default));
        address.setSelection(address.getText().length());
        if (configured) btnCancel.setVisibility(View.VISIBLE);

        try {
            String v = getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            version.setText("Version " + v);
        } catch (Exception ignored) {
            version.setText("");
        }

        // "Fertig" auf der Tastatur → gleich testen
        address.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_DONE) {
                hideKeyboard();
                runTest();
                return true;
            }
            return false;
        });
        btnTest.setOnClickListener(v -> {
            hideKeyboard();
            runTest();
        });
        btnSave.setOnClickListener(v -> save());
        btnCancel.setOnClickListener(v -> {
            setResult(RESULT_CANCELED);
            finish();
        });
    }

    private void runTest() {
        if (testing) return;
        final String base = ServerAddress.normalize(address.getText().toString());
        if (base.isEmpty()) {
            showStatus(getString(R.string.setup_empty), false);
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
                if (!isFinishing()) showStatus(r.message, r.ok);
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

    private void hideKeyboard() {
        InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
        if (imm != null) imm.hideSoftInputFromWindow(address.getWindowToken(), 0);
    }

    private void save() {
        String base = ServerAddress.normalize(address.getText().toString());
        if (base.isEmpty()) {
            showStatus(getString(R.string.setup_empty), false);
            return;
        }
        hideKeyboard();
        ServerAddress.prefs(this).edit().putString(ServerAddress.KEY_ADDRESS, base).apply();
        setResult(RESULT_OK);
        finish();
    }
}
