package de.partyjukebox.tv;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.LinearGradient;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.SweepGradient;
import android.view.View;

/*
 * Lernkarte: Bewegtes Logo (Jukebox-Bogen)
 * Das Startbild zeichnet das Logo selbst statt eines festen Bildes:
 *  - die fünf Balken hüpfen wie ein Equalizer (jeder mit eigenem Tempo),
 *  - im Bogen wandern die Farben (Pink → Lila → Cyan) im Kreis – ein Farbrad, das sich langsam dreht.
 * Koordinaten wie im SVG-Logo: Mitte (0,0), Bogen von x −80…80, oben bei y −100, Sockel bei y 100…114.
 */
public class LogoView extends View {
    private static final int PINK = 0xFFFF2EC8, VIOLET = 0xFF8B5CFF, CYAN = 0xFF00E5FF;
    private final Paint arch = new Paint(Paint.ANTI_ALIAS_FLAG), inner = new Paint(Paint.ANTI_ALIAS_FLAG),
            base = new Paint(Paint.ANTI_ALIAS_FLAG), bar = new Paint(Paint.ANTI_ALIAS_FLAG), mid = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path outer = new Path(), innerPath = new Path();
    private final Matrix rot = new Matrix();
    private SweepGradient sweep;
    private final long t0 = System.nanoTime();
    private static final float[] X = {-32, -16, 0, 16, 32}, H = {40, 70, 100, 70, 40};
    private static final float[] SPD = {5.1f, 6.7f, 4.3f, 7.3f, 5.9f}, PH = {0.3f, 1.7f, 0.9f, 2.6f, 4.1f};

    public LogoView(Context c) {
        super(c);
        setLayerType(LAYER_TYPE_SOFTWARE, null);   // nötig für den Leucht-Schatten
        arch.setStyle(Paint.Style.STROKE); arch.setStrokeJoin(Paint.Join.ROUND); arch.setStrokeCap(Paint.Cap.ROUND);
        inner.setStyle(Paint.Style.STROKE); inner.setStrokeCap(Paint.Cap.ROUND); inner.setAlpha(150);
        // Bogen: oben halbrund, unten offen; außen als geschlossene Form (mit Sockel-Linie)
        outer.moveTo(-80, 110); outer.lineTo(-80, -20); outer.arcTo(new RectF(-80, -100, 80, 60), 180, 180); outer.lineTo(80, 110); outer.close();
        innerPath.moveTo(-52, 110); innerPath.lineTo(-52, -14); innerPath.arcTo(new RectF(-52, -66, 52, 38), 180, 180); innerPath.lineTo(52, 110);
    }

    @Override protected void onAttachedToWindow() { super.onAttachedToWindow(); postInvalidateOnAnimation(); }

    @Override protected void onDraw(Canvas c) {
        float w = getWidth(), h = getHeight(), s = Math.min(w, h) / 250f;
        float t = (System.nanoTime() - t0) / 1e9f;
        c.save();
        c.translate(w / 2f, h / 2f - 7 * s);
        c.scale(s, s);
        if (sweep == null) {
            sweep = new SweepGradient(0, 0, new int[]{PINK, VIOLET, CYAN, VIOLET, PINK}, null);
            arch.setShader(sweep); inner.setShader(sweep); base.setShader(sweep);
            arch.setShadowLayer(9, 0, 0, 0xAAB04DFF); base.setShadowLayer(9, 0, 0, 0xAAB04DFF);
            bar.setShader(new LinearGradient(0, -20, 0, 80, 0xFFFF5FD8, 0xFF9B4DFF, Shader.TileMode.CLAMP));
            mid.setShader(new LinearGradient(0, -20, 0, 80, 0xFFFFFFFF, 0xFF7FE9FF, Shader.TileMode.CLAMP));
            bar.setShadowLayer(7, 0, 0, 0x88FF5FD8); mid.setShadowLayer(7, 0, 0, 0x887FE9FF);
        }
        rot.setRotate((t * 90f) % 360f);   // Farben wandern: eine Runde in 4 s
        sweep.setLocalMatrix(rot);
        arch.setStrokeWidth(12); inner.setStrokeWidth(5);
        c.drawPath(outer, arch);
        c.drawPath(innerPath, inner);
        for (int i = 0; i < 5; i++) {
            // Equalizer: zwei Sinus übereinander → wirkt lebendig statt gleichmäßig
            float v = 0.5f + 0.32f * (float) Math.sin(t * SPD[i] + PH[i]) + 0.18f * (float) Math.sin(t * SPD[i] * 2.3f + PH[i] * 1.7f);
            float hh = H[i] * (0.3f + 0.7f * Math.max(0f, Math.min(1f, v)));
            c.drawRoundRect(new RectF(X[i] - 7, 80 - hh, X[i] + 7, 80), 7, 7, i == 2 ? mid : bar);
        }
        c.drawRoundRect(new RectF(-95, 100, 95, 114), 7, 7, base);
        c.restore();
        if (isAttachedToWindow()) postInvalidateOnAnimation();
    }
}
