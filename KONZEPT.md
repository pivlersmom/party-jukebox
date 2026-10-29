# Party-Jukebox – Konzept

## Ziel
Jukebox (Handy), Party-Seite (Gäste) und TV-Anzeige als **ein Home-Assistant-Add-on**, das ein Freund
per Repository-URL installiert. Keine YAML-Dateien, keine HA-Tokens im Browser.

## Aufbau
```
party-jukebox/                 (GitHub-Repo = Add-on-Repository)
├─ repository.yaml
├─ party_jukebox/              (das Add-on)
│  ├─ config.yaml              Optionen, Port 8099, Zugriff auf HA-API
│  ├─ Dockerfile               Python + aiohttp
│  ├─ app/server.py            Webserver + Proxys + Party-Logik
│  └─ www/                     jukebox.html, party.html, tv.html (+ JS/CSS)
├─ android/tv-kiosk/           TV-App (Android-TV-Box, Fire TV)
├─ android/jukebox/            Jukebox-App (Android, optional)
└─ docs/                       GitHub-Seite: Anleitung + Downloads
```

## Server im Add-on
- Liefert die Seiten auf Port **8099** im Heimnetz aus (Gäste ohne HA-Login).
- `/api/*` und `/api/websocket` → Home Assistant (Supervisor-Token wird serverseitig eingesetzt).
- `/ma/ws` → Music Assistant (MA-Token aus den Add-on-Optionen wird serverseitig eingesetzt).
- `/party/*` → Party-Logik direkt im Add-on (bisher Template-Sensoren + Automationen in HA):
  Teilnehmer/Herzschlag, Wünsche + Widmung, Vordrängeln, Abstimmung (Skip bei Mehrheit),
  Nachschub mit Getränkewahl, Getränke-Ranking. Zustand in `/data/party.json`.

## Optionen (Add-on-Reiter „Konfiguration")
| Option | Bedeutung |
|---|---|
| `ma_url` | leer = Music-Assistant-Add-on automatisch finden |
| `ma_token` | Token aus MA → Einstellungen → Profil |
| `party_player` | MA-Player für Party/Jukebox-Start |
| `party_name` | Titel auf TV und Party-Seite (Standard „Party-Jukebox") |
| `notify_service` | z. B. `notify.mobile_app_xyz` für Nachschub-Meldungen (leer = aus) |
| `script_wish` / `script_boost` / `script_drink` | optionale HA-Skripte für Lichteffekte |
| `skip_votes` | Song bei Mehrheit 👎 überspringen (an/aus) |
| `drinks` | Getränkeliste (Standard: Bier, Weizen, Radler, Wein, Sekt, Cocktail, Schnaps, Cola, Wasser, Kaffee) |

## Geräte
| | Apple | Android |
|---|---|---|
| Jukebox | Web-App (Safari → Home-Bildschirm) | Web-App oder APK |
| Party-Seite | Safari | Chrome |
| TV | – | TV-APK (Android-TV-Box / Fire TV) |

Zugriff: Jukebox offen im Heimnetz (keine PIN). Gäste im getrennten Gäste-WLAN erreichen den Port nicht.

## Phasen
1. Add-on-Gerüst, Proxys, Party-Logik (Port aus `vanpis_party_events.jinja` + Automationen)
2. Party-Seite + TV-Seite auf Add-on umstellen (keine festen IPs/Entitäten)
3. Schlanke Jukebox (nur Musik-Module)
4. TV-APK (Einrichtung per Fernbedienung) + Jukebox-APK mit Adress-Einrichtung, Build über GitHub Actions → Releases
5. GitHub-Seite mit Anleitung + Downloads, Test-Installation
