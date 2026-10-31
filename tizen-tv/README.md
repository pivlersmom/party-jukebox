# 📺 Party-Jukebox TV für Samsung-Fernseher (Tizen)

Kleine Samsung-App, die die TV-Anzeige des Add-ons im Vollbild zeigt – wie die Android-TV-App:
Adresse einmal eingeben, danach startet sie direkt, der Bildschirmschoner bleibt aus.

> **Ohne App geht es auch:** Im Samsung-Internet-Browser `http://<IP-von-Home-Assistant>:8099/tv.html` öffnen,
> OK drücken → Vollbild. Die App lohnt sich, wenn der Fernseher oft für Partys genutzt wird.

Samsung erlaubt eigene Apps nur über den **Entwicklermodus** und mit einem **Zertifikat, das an den eigenen Fernseher gebunden ist**.
Deshalb gibt es hier keine fertige Datei zum Herunterladen – die App wird einmal am eigenen PC signiert und auf den Fernseher geschickt.
Das dauert beim ersten Mal ca. 30–45 Minuten.

---

## Was man braucht
- einen **PC oder Mac** (Windows, macOS oder Linux) im **selben WLAN/Netz** wie der Fernseher
- ein **Samsung-Konto** (kostenlos)
- diesen Ordner `tizen-tv` (auf GitHub: *Code → Download ZIP*, entpacken)

## 1. Tizen Studio auf dem PC installieren
1. Bei Samsung **Tizen Studio** herunterladen: <https://developer.tizen.org/development/tizen-studio/download>
   (die Variante *mit IDE* ist am einfachsten).
2. Installieren und den **Package Manager** öffnen (startet nach der Installation, sonst über das Startmenü).
3. Im Reiter **Extension SDK** installieren:
   - **Samsung Certificate Extension**
   - **TV Extensions** (die neueste Version)

## 2. Entwicklermodus am Fernseher einschalten
1. Die **IP-Adresse des PCs** herausfinden (Windows: `ipconfig`, Mac: Systemeinstellungen → Netzwerk).
2. Am Fernseher **Apps** öffnen und auf der Fernbedienung **1 2 3 4 5** eingeben
   (bei manchen Modellen über die Zifferntasten der Bildschirm-Fernbedienung).
3. **Developer mode** auf **On**, die **IP-Adresse des PCs** eintragen, OK.
4. Den Fernseher **ganz ausschalten** (Netzstecker kurz ziehen oder Ein/Aus lange drücken) und wieder einschalten.

## 3. Fernseher mit dem PC verbinden
1. In Tizen Studio **Tools → Device Manager** öffnen.
2. **Remote Device Manager** (bzw. *Scan*) → **+** → Name beliebig, **IP-Adresse des Fernsehers** eintragen → verbinden.
   (Die IP des Fernsehers steht unter Einstellungen → Allgemein → Netzwerk → Netzwerkstatus.)
3. Der Fernseher erscheint in der Liste als verbunden.

## 4. Samsung-Zertifikat erstellen
1. **Tools → Certificate Manager** → **+**.
2. **Samsung** wählen → Gerätetyp **TV** → einen Profilnamen vergeben (z. B. `party-tv`).
3. *Create a new author certificate* → Name und Passwort ausdenken (gut merken).
4. Mit dem **Samsung-Konto anmelden**, wenn das Fenster erscheint.
5. *Distributor certificate*: **Privilege: Partner** wählen und sicherstellen, dass die **DUID des Fernsehers** in der Liste steht
   (wird automatisch eingetragen, solange der Fernseher verbunden ist).
6. Fertigstellen. Das Profil `party-tv` ist jetzt aktiv.

## 5. App bauen und installieren
1. In Tizen Studio **File → Import → Tizen → Tizen Project** → den Ordner `tizen-tv` auswählen → Profil **tv-samsung**.
2. Im Device Manager mit der rechten Maustaste auf den Fernseher → **Permit to install applications**.
3. Rechtsklick auf das Projekt → **Run As → Tizen Web Application**.
   Tizen Studio baut die App, signiert sie mit dem Zertifikat und startet sie auf dem Fernseher.

<details><summary>Alternativ über die Kommandozeile</summary>

```bash
cd tizen-tv
tizen package -t wgt -s party-tv -- .          # erzeugt "Party-Jukebox TV.wgt"
sdb connect <IP-des-Fernsehers>
sdb devices                                     # Gerätename merken, z. B. UE55TU7090
tizen install-permit -t <Gerätename>
tizen install -n "Party-Jukebox TV.wgt" -t <Gerätename>
```
</details>

## 6. Am Fernseher einrichten
1. **Party-Jukebox TV** startet (später in der App-Leiste zu finden).
2. Die Adresse von Home Assistant eingeben, z. B. `192.168.178.20` – `http://` und `:8099` werden ergänzt.
3. **Testen** → **Speichern & starten**.

**Bedienung:** Zurück **lange drücken** oder **3× schnell** = Einstellungen · Zurück **2×** = App beenden.
Ist die Party-Jukebox nicht erreichbar, versucht es die App alle 10 Sekunden erneut.

## Gut zu wissen
- Den **Entwicklermodus** kann man danach wieder ausschalten – die App bleibt installiert.
- Das Zertifikat ist **mehrere Jahre gültig**. Läuft es ab oder kommt ein neuer Fernseher dazu, Schritte 3–5 wiederholen.
- Auf älteren Fernsehern (vor ca. 2018) in der Jukebox unter ⚙ → TV-Anzeige den **Spar-Modus** wählen, falls es ruckelt.
- **LG-Fernseher (webOS):** dort am einfachsten den Browser nutzen (siehe oben).
