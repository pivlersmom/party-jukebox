# Party-Jukebox – Anleitung

## 1. Music Assistant vorbereiten
1. Music Assistant (ab Version 2.x) muss laufen und deine Lautsprecher kennen.
2. In Music Assistant unter **Einstellungen → Plugins** das Plugin **Party** hinzufügen und aktivieren.
   Darüber melden sich die Gäste an (QR-Code mit Join-Code).
3. Unter **Einstellungen → Profil** einen **Token** erstellen und kopieren.
4. Optional für Songtexte auf dem TV: unter **Einstellungen → Anbieter** die Metadaten-Anbieter **LRCLIB** und/oder **Genius Lyrics** hinzufügen.
   Ohne sie sucht die TV-Anzeige selbst bei lrclib.net (der Fernseher braucht dafür Internet).

## 2. Add-on einrichten
1. Reiter **Konfiguration**: Token bei **Music-Assistant-Token** einfügen.
2. Optional:
   - **Party-Name** – erscheint auf TV und Party-Seite.
   - **Party-Player** – der Lautsprecher bzw. die Gruppe für die Party (Name wie in Music Assistant). Leer = der gerade spielende.
   - **Benachrichtigung für Nachschub** – z. B. `notify.mobile_app_mein_handy`, dann kommt jede Getränkebestellung aufs Handy oder die Uhr.
   - **Skripte** – eigene HA-Skripte für Lichteffekte bei Wunsch, Vordrängeln oder Nachschub.
     Fertige Vorlagen (nur noch Lampen eintragen): Ordner `lichteffekte` im GitHub-Repo – https://github.com/pivlersmom/party-jukebox/tree/main/lichteffekte
   - **Getränke** – eigene Getränkeliste (`Name|Emoji|Satz`).
3. Speichern, Add-on **starten**, **Web-UI öffnen**.

Die Startseite ist im Heimnetz unter `http://<IP-von-Home-Assistant>:8099` erreichbar.

## 3. Geräte

### Fernseher (TV-Anzeige)
- **Android-TV-Box / Fire TV:** die **TV-App** aus den Releases auf GitHub installieren, beim ersten Start die Adresse
  `http://<IP>:8099` eingeben, *Testen*, *Speichern*.
- **Ohne App:** im Browser des Fernsehers `http://<IP>:8099/tv.html` öffnen.
- Tipp: die **IP-Adresse** verwenden, nicht `homeassistant.local` – sonst können manche Handys den QR-Code nicht öffnen.

### Jukebox (für dich)
- **iPhone/iPad:** in Safari `http://<IP>:8099/jukebox.html` öffnen → Teilen → **Zum Home-Bildschirm**.
- **Android:** in Chrome öffnen → ⋮ → **App installieren**, oder die Jukebox-App aus den Releases.

### Gäste (Party-Seite)
- Gäste scannen den **QR-Code auf dem Fernseher** und landen auf der Party-Seite.
- Dort können sie Songs wünschen (mit Widmung), sich vordrängeln, über den laufenden Song abstimmen und Nachschub bestellen.
- Die Gäste müssen im **gleichen WLAN** sein wie Home Assistant.

## 4. Sicherheit
- Die Seiten sind ohne Anmeldung im Heimnetz erreichbar. Wer im WLAN ist, kann auch die Jukebox öffnen.
- Auf Home Assistant selbst haben die Seiten **keinen Zugriff** – niemand kann über das Add-on Lichter, Schlösser o. Ä. steuern.
- Port 8099 **nicht** im Router ins Internet freigeben.

## 5. Probleme
| Problem | Lösung |
|---|---|
| „Music Assistant ist noch nicht eingerichtet“ | Token in der Konfiguration eintragen, Add-on neu starten |
| TV zeigt keinen QR-Code bzw. Gäste kommen nicht rein | Party-Plugin in Music Assistant aktivieren |
| Handy öffnet den QR-Code nicht | TV-Seite über die IP-Adresse statt `homeassistant.local` öffnen |
| Falscher Lautsprecher | **Party-Player** in der Konfiguration setzen bzw. in der Jukebox oben rechts wechseln |
| Song wird trotz 👎 nicht übersprungen | Option **Abstimmung überspringt Songs** prüfen; nötig ist die Mehrheit der Gäste (mindestens 2) |

Logs: Reiter **Protokoll** des Add-ons.
