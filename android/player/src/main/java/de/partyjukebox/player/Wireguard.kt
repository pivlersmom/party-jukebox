package de.partyjukebox.player

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager

/*
 * Lernkarte: WireGuard aus der App heraus einschalten
 * Die WireGuard-App (com.wireguard.android) lässt sich von anderen Apps steuern, wenn man in ihren
 * Einstellungen "Fernsteuerung durch Apps erlauben" einschaltet. Dann reicht eine Nachricht (Broadcast)
 * "Tunnel XY an/aus". Dafür braucht unsere App einmalig die Berechtigung CONTROL_TUNNELS (fragt Android nach).
 * Mit eingeschaltetem Tunnel ist das Heimnetz unterwegs direkt erreichbar → kein Umweg über die Nabu-Casa-Cloud.
 */
object Wireguard {
    const val PKG = "com.wireguard.android"
    const val PERM = "com.wireguard.android.permission.CONTROL_TUNNELS"

    @JvmStatic fun installed(c: Context): Boolean =
        try { c.packageManager.getPackageInfo(PKG, 0); true } catch (e: Exception) { false }

    @JvmStatic fun allowed(c: Context): Boolean = c.checkSelfPermission(PERM) == PackageManager.PERMISSION_GRANTED

    /** Tunnel an-/ausschalten; false, wenn WireGuard fehlt oder die Berechtigung nicht erteilt ist */
    fun set(c: Context, tunnel: String, up: Boolean): Boolean {
        if (tunnel.isEmpty() || !installed(c)) { AppLog.add("VPN: WireGuard-App fehlt"); return false }
        if (!allowed(c)) { AppLog.add("VPN: Berechtigung für WireGuard fehlt (Einstellungen → Auto)"); return false }
        c.sendBroadcast(Intent(if (up) "$PKG.action.SET_TUNNEL_UP" else "$PKG.action.SET_TUNNEL_DOWN")
            .setPackage(PKG).putExtra("tunnel", tunnel))
        AppLog.add("VPN „" + tunnel + "“ " + (if (up) "eingeschaltet" else "ausgeschaltet"))
        return true
    }
}
