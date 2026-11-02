# Party-Jukebox – Anleitung

## 1. Music Assistant vorbereiten
1. Music Assistant (ab Version 2.x) muss laufen und deine Lautsprecher kennen.
2. Plugin **Party**: am einfachsten später in der Jukebox unter ⚙ → **Party-Plugin → Installieren** (dort auch ein/aus).
   Alternativ in Music Assistant unter **Einstellungen → Plugins** hinzufügen. Darüber melden sich die Gäste an (QR-Code mit Join-Code).
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
- **Samsung (Tizen):** eigene App im GitHub-Repo, Ordner `tizen-tv` (Installation über den Entwicklermodus, Anleitung dort).
- **Ohne App (LG, Samsung, PC …):** im Browser des Fernsehers `http://<IP>:8099/tv.html` öffnen und **OK / Enter** drücken → Vollbild.
- Tipp: die **IP-Adresse** verwenden, nicht `homeassistant.local` – sonst können manche Handys den QR-Code nicht öffnen.

### Jukebox (für dich)
- **iPhone/iPad:** in Safari `http://<IP>:8099/jukebox.html` öffnen → Teilen → **Zum Home-Bildschirm**.
- **Android:** in Chrome öffnen → ⋮ → **App installieren**, oder die Jukebox-App aus den Releases.

### Gäste (Party-Seite)
- Gäste scannen den **QR-Code auf dem Fernseher** und landen auf der Party-Seite.
- Dort können sie Songs wünschen (mit Widmung), sich vordrängeln, über den laufenden Song abstimmen und Nachschub bestellen.
- Die Gäste müssen im **gleichen WLAN** sein wie Home Assistant.

## 4. Jukebox-Einstellungen (⚙ oben rechts)
- **Lichteffekte, Abstimmung, Gast-Limits** – gelten sofort.
- **TV-Anzeige** – Songtext-Versatz (+ = Text früher) und Darstellung (Spar-Modus für langsame TV-Boxen).
- **Räume · Auto-Beitritt** – je Raum Lautsprecher und Bewegungsmelder wählen:
  - Bewegung im Raum → die Box spielt die gerade laufende Musik mit.
  - Keine Bewegung für die eingestellte Zeit → die Box verlässt die Gruppe wieder (0 = nie).
  - Schloss-Knopf sperrt den Raum für die eingestellte Zeit. Optional ein eigener HA-Schalter als Sperre (z. B. damit Alexa sperren kann).
  - „Nur wenn“ (optional): zusätzliche Bedingung, z. B. `sensor.ladestation=charging`.
  - Läuft an der Soundbar gerade TV-Ton, wird nichts verbunden oder getrennt.
- **Party-Plugin** – in Music Assistant installieren, ein-/ausschalten, Link zu allen Plugin-Einstellungen.
- **Startseite** – pro Person: Reihenfolge der Reihen (Zuletzt gespielt, Favoriten, Empfehlungen, Meine Playlists, Neue Podcast-Folgen) mit ▲▼ ändern, einzelne Reihen ausblenden. Ohne eigene Wahl stehen die Podcast-Folgen oben, wenn jemand mind. 3 Lieblings-Podcasts hat.
- **Schalter** – ausgewählte Home-Assistant-Schalter direkt in der Jukebox ein-/ausschalten:
  - „Schalter auswählen“ zeigt zuerst die **Helfer** (`input_boolean`). Einen Helfer legst du in HA unter *Einstellungen → Geräte & Dienste → Helfer → Helfer erstellen → Schalter* an und fragst ihn in deiner Automation als Bedingung ab (z. B. „Musik beim Heimkommen nur wenn Helfer an“).
  - Über das **Suchfeld** findest du auch alle anderen Schalter (`switch.*`, z. B. Steckdosen).
  - Nur ausgewählte Schalter erscheinen – nichts ausgewählt = der Bereich bleibt leer. Max. 20.
  - Nur für den Gastgeber; Gäste sehen und schalten nichts.
- **TV-Ton** – bei Lautsprechern mit TV-Eingang (z. B. Sonos Beam): Warteschlange → Mülleimer-Knopf → „📺 TV-Ton“. Ist der Fernseher aktiv, steht dort „🎵 Zurück zur Musik“.
- **Favoriten pro Person** – ♥ bei Playlist/Album/Künstler oder Cover lange drücken. Die Jukebox merkt sich, wer was markiert hat (Music Assistant selbst kennt Favoriten nur für alle). „Neue Podcast-Folgen“ lässt sich pro Person mit „↑ Ganz oben“ an den Anfang der Startseite holen.
- **Favoriten** – im Reiter „Läuft“ das Cover lange drücken.
- **Songtext** – im Reiter „Läuft“ das Cover kurz antippen.

## 5. Sicherheit
- **Gastgeber-PIN** in der Jukebox unter ⚙ → Gastgeber-PIN festlegen: Danach sind Jukebox, Einstellungen und Vollzugriff auf Music Assistant nur nach PIN erreichbar (jedes Gerät einmal, bleibt angemeldet). Gäste-Seite und TV-Anzeige bleiben frei. Auf der Gäste-Seite: Logo lange drücken → PIN → Jukebox. Ohne PIN kann jeder im WLAN die Jukebox öffnen.
- Auf Home Assistant haben die Seiten **keinen allgemeinen Zugriff** – nur die Schalter, die du unter ⚙ → Schalter selbst ausgewählt hast, und nur aus der Jukebox (Gastgeber). Gäste-Seite und TV-Anzeige können nichts schalten.
- Port 8099 **nicht** im Router ins Internet freigeben.

## 6. Probleme
| Problem | Lösung |
|---|---|
| „Music Assistant ist noch nicht eingerichtet“ | Token in der Konfiguration eintragen, Add-on neu starten |
| TV zeigt keinen QR-Code bzw. Gäste kommen nicht rein | Jukebox ⚙ → Party-Plugin installieren bzw. einschalten |
| Handy öffnet den QR-Code nicht | TV-Seite über die IP-Adresse statt `homeassistant.local` öffnen |
| Falscher Lautsprecher | **Party-Player** in der Konfiguration setzen bzw. in der Jukebox oben rechts wechseln |
| Songtext läuft zu früh/zu spät | Jukebox ⚙ → **Songtext-Versatz** anpassen (+ = Text früher) |
| TV ruckelt | Jukebox ⚙ → Darstellung **Spar-Modus** |
| Song wird trotz 👎 nicht übersprungen | Option **Abstimmung überspringt Songs** prüfen; nötig ist die Mehrheit der Gäste (mindestens 2) |

Logs: Reiter **Protokoll** des Add-ons.

## Mehrere Musik-Konten (Profile)

Hat Music Assistant mehrere Benutzer (Einstellungen → Benutzerverwaltung), zeigt die Jukebox unter **Suche** oben „Musik von …“.
Jedes Gerät merkt sich sein Profil. Suche, Playlists, Lieblingssongs und Abspielen laufen dann nur über die Musikquellen,
die in Music Assistant für diesen Benutzer freigegeben sind – z. B. ein zweites Spotify-Konto als eigene Musikquelle.

## TV-Ton anzeigen (optional)

Spielt eine Soundbar (z. B. Sonos Beam) den Ton vom Fernseher, kann die Jukebox statt „TV Audio“ zeigen, was läuft:
- **TV-Ton – Cast-Player:** Cast-Player des TV-Geräts (z. B. einer TV-Box). Liefert Sender und Sendung bzw. App und Titel.
- **TV-Ton – weitere Player:** z. B. Android-TV- oder Fire-TV-Player, mit Komma getrennt – für den App-Namen.
- **Senderlogos (optional):** eine JS-Datei unter /local mit `{"sendername": "datei.png"}` und der Ordner der Logos.
