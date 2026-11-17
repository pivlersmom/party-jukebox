package de.partyjukebox.player

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import java.net.HttpURLConnection
import java.net.URL

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
        Endpoint.prefs(c).edit().putBoolean("vpn_by_us", up).apply()   // merken (überlebt Neustart der App)
        return true
    }

    /** Hat die App den Tunnel selbst eingeschaltet? */
    @JvmStatic fun byUs(c: Context) = Endpoint.prefs(c).getBoolean("vpn_by_us", false)

    /*
     * Lernkarte: Bin ich wirklich zuhause?
     * Viele Router (auch bei der Arbeit) nutzen 192.168.178.x – die Adresse allein reicht nicht.
     * Darum fragt die App Home Assistant direkt über das WLAN an (am VPN vorbei: Network.openConnection).
     * Antwortet es, ist das Handy im eigenen WLAN – dann wird der selbst eingeschaltete Tunnel abgeschaltet.
     * Blockiert bis zu ~2 s → nicht im Hauptthread aufrufen.
     */
    @JvmStatic fun atHome(c: Context): Boolean {
        if (Build.VERSION.SDK_INT < 23 || Endpoint.LOCAL.isEmpty()) return false
        val cm = c.getSystemService(ConnectivityManager::class.java) ?: return false
        @Suppress("DEPRECATION")
        for (n in cm.allNetworks) {
            val nc = cm.getNetworkCapabilities(n) ?: continue
            if (!nc.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || nc.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) continue
            var con: HttpURLConnection? = null
            try {
                con = n.openConnection(URL(Endpoint.LOCAL + "config.js")) as HttpURLConnection
                con.connectTimeout = 1500; con.readTimeout = 1500
                if (con.responseCode in 200..399) return true
            } catch (e: Exception) { } finally { con?.disconnect() }
        }
        return false
    }

    /** Zuhause angekommen und der Tunnel ist von uns → abschalten */
    @JvmStatic fun homeCheck(c: Context) {
        if (!byUs(c)) return
        Thread {
            if (atHome(c)) set(c, Endpoint.prefs(c).getString("vpn_tunnel", "") ?: "", false)
        }.start()
    }

    /** WLAN-Wechsel beobachten (läuft, solange der Medien-Dienst lebt) */
    private var cb: ConnectivityManager.NetworkCallback? = null
    @JvmStatic fun watch(c: Context) {
        if (Build.VERSION.SDK_INT < 24 || cb != null) return
        val app = c.applicationContext
        val cm = app.getSystemService(ConnectivityManager::class.java) ?: return
        val k = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) { homeCheck(app) }
        }
        try {
            cm.registerNetworkCallback(NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI).build(), k)
            cb = k
        } catch (e: Exception) { }
    }
}
