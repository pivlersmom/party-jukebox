# 🎉 Party-Jukebox

Home-Assistant-Add-on für Partys mit **Music Assistant**:

- **Jukebox** – Handy-Fernbedienung: suchen, Warteschlange, Lautstärke (auch für Lautsprechergruppen)
- **Party-Seite** – Gäste scannen einen QR-Code und können Songs wünschen (mit Widmung), sich vordrängeln, über den laufenden Song abstimmen und Getränke-Nachschub bestellen
- **TV-Anzeige** – für den Fernseher: aktueller Song, Warteschlange, „Als Nächstes“, „Zuletzt gespielt“, QR-Code, neue Gäste, Getränke-Ranking, Nachschub-Hinweis

> ⚠️ **In Entwicklung** – noch nicht für den Einsatz fertig. Stand siehe [Fortschritt](#fortschritt).

---

## Voraussetzungen

- Home Assistant OS oder Supervised (Add-ons müssen möglich sein)
- [Music Assistant](https://www.music-assistant.io/) ab 2.x als Add-on, mit dem **Party**-Plugin
- Lautsprecher, die in Music Assistant eingebunden sind (Sonos, AirPlay, Chromecast …)

## Installation

1. In Home Assistant: **Einstellungen → Add-ons → Add-on Store → ⋮ → Repositories**
2. URL hinzufügen: `https://github.com/pivlersmom/party-jukebox`
3. **Party-Jukebox** installieren
4. Im Reiter **Konfiguration** mindestens den **Music-Assistant-Token** eintragen  
   (Music Assistant → Einstellungen → Profil → Token erstellen)
5. Add-on starten → **Web-UI öffnen** (oder im Heimnetz `http://<HA-IP>:8099`)

## Optionen

| Option | Bedeutung |
|---|---|
| `ma_url` | Leer lassen = Music-Assistant-Add-on wird automatisch gefunden |
| `ma_token` | Token aus Music Assistant (Pflicht) |
| `party_name` | Titel auf TV und Party-Seite |
| `party_player` | MA-Player für die Party (leer = der gerade spielende) |
| `notify_service` | z. B. `notify.mobile_app_mein_handy` – Nachschub-Bestellungen aufs Handy/die Uhr (leer = aus) |
| `script_wish` / `script_boost` / `script_drink` | Optionale HA-Skripte, z. B. für Lichteffekte bei Wunsch, Vordrängeln, Nachschub |
| `skip_votes` | Song überspringen, wenn die Mehrheit der Gäste 👎 stimmt |
| `drinks` | Getränkeliste, je Zeile `Name|Emoji|Satz` (z. B. `Bier|🍺|ein Bier`) |

## Geräte

| | iPhone / iPad | Android | Fernseher |
|---|---|---|---|
| **Jukebox** | Safari → `…:8099/jukebox.html` → Teilen → *Zum Home-Bildschirm* | Chrome → *App installieren* (oder APK) | – |
| **Party-Seite** | QR-Code vom TV scannen | QR-Code vom TV scannen | – |
| **TV-Anzeige** | – | – | Android-TV-Box / Fire TV mit TV-APK, oder Browser auf `…:8099/tv.html` |

Die Apps (TV-APK, Jukebox-APK) gibt es künftig unter [Releases](https://github.com/pivlersmom/party-jukebox/releases).

## Sicherheit

- Die Seiten sind **ohne Anmeldung im Heimnetz** erreichbar (Port 8099). Wer im WLAN ist, kann die Jukebox bedienen.
- Das Add-on gibt **keinen Zugriff auf Home Assistant** an den Browser weiter. Gäste können also nichts im Haus steuern – HA wird nur vom Add-on selbst genutzt (optionale Skripte, Benachrichtigungen).
- Gäste in einem getrennten Gäste-WLAN erreichen die Seiten nicht. Port 8099 **nicht** ins Internet freigeben.

## Fortschritt

- [x] Add-on-Grundgerüst, Server mit Party-Logik und Music-Assistant-Anbindung
- [x] Party-Seite
- [x] TV-Anzeige
- [x] Schlanke Jukebox (Web-App)
- [x] TV-APK und Jukebox-APK (automatischer Build über GitHub Actions)
- [x] Anleitung (Add-on-Reiter „Dokumentation“)
- [ ] Erstes Release mit festem Signierschlüssel
- [ ] Test-Installation

## Lizenz

Privates Projekt, Nutzung auf eigene Gefahr.
