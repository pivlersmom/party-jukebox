# Änderungen

## 0.1.147
- Neuer Start-Sound (Bass-Wumms + jubelndes Publikum) in App 3.9.60 und TV-App 0.1.5 (TV-App mit kurzem Startbild)
- „created by pivlersmom“ auf der Startseite und im Startbild der Apps
- Warteschlange zeigt, welche Playlist / welches Album / welcher Endless Mix gerade läuft

## 0.1.146
- Start-Sound „Created for you“: App (3.9.59, abschaltbar unter Persönlich → Auto) und TV-App 0.1.4
- TV- und Jukebox-App 0.1.4 zum Herunterladen auf der Startseite

## 0.1.145
- „Hinten anstellen“: Reihenfolge wird positionsunabhängig hergestellt – jeder neue Wunsch landet hinter dem vorherigen (auch im Endless Mix)
- Warteschlange: Zurück-Knopf zur vorher genutzten Seite (auch zurück in den aufgeklappten Player)

## 0.1.144
- Endless Mix: „Hinten anstellen“ hält Wünsche fest in der Liste (MA hat sonst die ganze Liste neu gemischt und Wünsche verworfen) – Wünsche kommen in Wunsch-Reihenfolge vor den Mix
- Autoplay-Wächter mit einer dauerhaften MA-Verbindung (keine Anmeldung alle 5 s im MA-Log)

## 0.1.143
- „Hinten anstellen“ setzt Titel hinter die eigenen Songs – Autoplay-Titel bleiben immer am Ende (auch bei Zufallswiedergabe)
- Add-on merkt sich, welche Titel Music Assistant per Autoplay angehängt hat

## 0.1.142
- Aufgeklappter Player: Knopf oben rechts öffnet direkt die Warteschlange

## 0.1.141
- 🎤 Sprachsuche rechts im Suchfeld – in der Jukebox und auf der Party-Seite (Browser: eingebaute Spracherkennung, App: Google-Spracheingabe)

## 0.1.140
- „Benutzeroberfläche öffnen“ in Home Assistant zeigt wieder die Startseite mit der Auswahl (Jukebox, Party, TV)

## 0.1.139
- Playlist, Album, Künstler, Podcast oder Hörbuch abspielen ersetzt jetzt die Warteschlange – alte Titel bleiben nicht mehr hinten dran

## 0.1.138
- ♥ per langem Druck aufs Cover landet jetzt auch in den persönlichen Favoriten der Person (Startseite → Favoriten)

## 0.1.137
- Radio: Cover lange drücken findet den laufenden Song wieder (Suche lief ins Leere)

## 0.1.136
- Party: Gäste zählen 2 Stunden nach ihrer letzten Aktivität als „dabei“ – für die Mehrheit beim Abwählen und für „Musik geht nie aus“ (auch wenn die Seite zu ist)

## 0.1.135
- Party: Läuft der vorletzte Song, kurzes Banner „Nur noch 2 Songs – jetzt wünschen!“ auf Fernseher und Party-Seite
- Party: „Musik geht nie aus“ – ohne Endlosschleife schaltet sich beim vorletzten Song Autoplay ein (Einstellungen → Party)

## 0.1.134
- Übergang lange drücken: Aus / Standard / Smart, bei Standard die Dauer (1–15 s)
- AI DJ: Tippen = an/aus mit zuletzt gewähltem Moderator, lange drücken = Moderator auswählen

## 0.1.133
- Jukebox: Beschriftung unter den Knöpfen im Player (Song-Radio, Übergang, Qualität, AI DJ, Autoplay)

## 0.1.132
- Party: doppelte Wünsche verhindern – auch gleiche Songs von anderem Dienst oder als Remaster, und was in den letzten 3 Stunden lief (Einstellungen → Party → „Doppelte Songs verhindern“)

## 0.1.131
- Kein Ton mehr auf der Box beim normalen Wunsch

## 0.1.130
- Vordrängeln: kurzes Scratchen, dann Buh einer ganzen Menge – Durchsage entfernt (Option tts_engine entfällt)

## 0.1.129
- Vordrängeln: Buh + Durchsage als eine Ansage (Musik lief danach nicht weiter); läuft sie nach einem Party-Ton nicht wieder, wird fortgesetzt

## 0.1.128
- Vordrängeln: Buh-Konzert und Durchsage „Achtung, Achtung! <Name> hat sich vorgedrängelt!“ auf dem Lautsprecher (TTS aus Home Assistant, neue Option tts_engine)

## 0.1.127
- Party-Töne laufen auf dem Player, den die TV-Anzeige gerade zeigt

## 0.1.126
- Party: Wunsch-Klimpern, Bier-Einschenken und Buh beim Vordrängeln auch auf dem Lautsprecher, der gerade spielt (Einstellungen → Party, abschaltbar)

## 0.1.125
- App: Schalter „Unterwegs per WebRTC verbinden“ (Standard aus = Nabu Casa)

## 0.1.124
- Einstellungen → „Meldungen der App“ (nur in der Android-App): Abbrüche, Aussetzer und Fehler verständlich übersetzt


## 0.1.123
- Podcast-Push: „Jetzt abspielen“ versucht es bis zu 20 s lang (Handy-Lautsprecher wacht evtl. gerade auf)

## 0.1.122
- Radio: Cover lange drücken merkt den laufenden Song als Favorit (statt des Senders); Ring zeigt den Song

## 0.1.121
- Lautsprecher ausblenden greift jetzt; Bereich liegt unter „Persönlich“

## 0.1.120
- Startseite: Reihen rasten mit Abstand zum linken Rand ein

## 0.1.119
- Einstellungen → Persönlich → Lautsprecher: nicht genutzte Lautsprecher pro Profil ausblenden

## 0.1.118
- „Abspielen auf“: spielende Lautsprecher mit animierten Balken statt ▶

## 0.1.117
- Android-App: Einstellungs-Knopf rechts oben (statt des Gäste-Knopfs)

## 0.1.116
- Android-App: Knopf zur Gäste-Seite oben ausgeblendet (bleibt unter Einstellungen → Party)

## 0.1.115
- „Abspielen auf“ auch auf der Seite einer Playlist, eines Albums, Podcasts oder Künstlers

## 0.1.114
- Lautsprecher-Auswahl: ⇄ übergibt die laufende Musik samt Warteschlange an einen anderen Lautsprecher

## 0.1.113
- Abspiel-Menü zeigt „Abspielen auf“ mit allen Lautsprechern (gewählter hervorgehoben, spielende mit ▶) – Ziel direkt dort ändern; Bestätigung nennt den Lautsprecher

## 0.1.112
- Einstellungen → Persönlich: neuer Bereich „Handy im Auto“ (wer bin ich, Podcast-Vorschlag, Adressen der App) für die Android-App

## 0.1.111
- App-Updates: Die Android-App kann neue Versionen aus einem (auch privaten) GitHub-Repository über das Add-on laden (Optionen „App-Updates“)

## 0.1.110
- Fern-Log der Jukebox-App: Ereignisse des Handy-Players erscheinen im Add-on-Protokoll (Fehlersuche)

## 0.1.109
- Jukebox auf dem Echo Show (Silk-Browser): erster Tipp schaltet Vollbild ein

## 0.1.108
- Podcast-Push mit Bluetooth-Sensor als Auslöser: nur noch verbundene Geräte zählen (gekoppelte, aber ausgeschaltete Autos lösten fälschlich aus)

## 0.1.107
- Handy-Player-Status bricht um (zeigt auch die Aussetzer-Zähler der App)

## 0.1.106
- Einstellungen: neuer Reiter „Klang“ für den gewählten Lautsprecher – Klangregelung an/aus, Bass, Mitten, Höhen, Balance, Voreinstellungen aus Music Assistant

## 0.1.105
- Suche mit Profil: Bibliothek wird mit durchsucht (Treffer auch, wenn Spotify gerade gedrosselt ist)
- Neue Podcast-Folgen 2 Stunden auf dem Gerät gemerkt (weniger Spotify-Anfragen)

## 0.1.104
- Logo oben links bewegt sich, solange Musik läuft (drehender Farbschein, leichtes Pochen)

## 0.1.103
- Startseite: Favoriten als waagerechte Reihe wie die anderen Bereiche
- Überschriften der Bereiche größer und mit Farbbalken hervorgehoben

## 0.1.102
- Einstellungen → Handy als Lautsprecher: Format und Verbindungsweg (direkt / WebRTC / Nabu Casa) gut lesbar; „Name des Players“ statt veraltetem „Einrichten / anmelden“

## 0.1.101
- Mini-Player: Cover auch unterwegs (Bild-Adresse des Players wird über das Add-on geladen); bei Podcasts/Hörbüchern steht der Name darunter

## 0.1.100
- Sendspin-Weiterleitung (/sendspin): Handy-Player der Android-App funktioniert auch unterwegs über Nabu Casa, ohne VPN

## 0.1.99
- Podcast-Push: Equalizer-Symbol in Logo-Farbe (Pink)

## 0.1.98
- Podcast-Push: Party-Jukebox-Logo als großes Symbol, Podcast-Symbol in der Statusleiste (Android)

## 0.1.97
- Podcast-Push: solange Android Auto/CarPlay aktiv ist, zusätzlich jede Stunde prüfen

## 0.1.96
- „Podcasts für dich“ wird 12 Stunden gemerkt (weniger Suchanfragen an Spotify)

## 0.1.95
- Podcast-Push: immer die wirklich neueste Folge (nach Datum, sonst Folgennummer); „Jetzt prüfen“ schickt die aktuellste Folge auch wenn schon gehört

## 0.1.94
- Push bei neuen Podcast-Folgen pro Person: einmal prüfen, wenn Android Auto/CarPlay aktiv wird; Benachrichtigung mit Cover und „Jetzt abspielen“
- Anleitung: Auslöser für Android Auto, Bluetooth und CarPlay

## 0.1.93
- „Neue Podcast-Folgen“: schon gehörte Folgen werden ausgeblendet

## 0.1.92
- Startseite: „Neue Podcast-Folgen“ zeigt ohne Folge der letzten 7 Tage die neueste Folge je Podcast
- Neue Reihe „Podcasts für dich“ (ähnlich wie die eigenen Lieblings-Podcasts), in der Reihenfolge einstellbar
- Android-App: Reihenfolge der Startseite gilt auch für den Start-Reiter in Android Auto

## 0.1.91
- Titel in Playlist/Album/Podcast antippen → „Playlist ab hier“: die ganze Liste startet bei diesem Titel
- Suchfeld in langen Listen (ab 40 Einträgen), z. B. „Folge 12“ in einer Playlist mit allen Folgen

## 0.1.90
- Schnell-Scrollleiste rechts bei Playlists, Alben und Podcast-Folgen (ab 40 Einträgen): erscheint nur beim Scrollen, Ziehen springt durch die ganze Liste, Blase zeigt Nummer und Titel

## 0.1.89
- Schwebender Zurück-Knopf (bleibt beim Scrollen stehen) in Playlist, Album, Künstler, Podcast und Favoriten-Listen
- Große Playlists: alle Titel, je 200 beim Runterscrollen nachgeladen (vorher max. 300); lange Ladezeiten brechen nicht mehr ab

## 0.1.88
- Einstellungen in Reitern: Persönlich · Party · TV & Räume · Info (letzter Reiter bleibt gewählt)

## 0.1.87
- Einstellungen → Startseite: Reihenfolge der Reihen pro Person festlegen (▲▼) und einzelne Reihen ausblenden

## 0.1.86
- Empfehlungen auf der Startseite im Namen der gewählten Person (ihr Hörverhalten, ihre Musikquellen)
- „Neue Podcast-Folgen“ automatisch ganz oben, wenn jemand mind. 3 Lieblings-Podcasts hat (per „↑/↓“ änderbar)

## 0.1.85
- Favoriten: Zuordnung über die Adresse statt über den Namen (gleichnamige Podcasts werden nicht mehr alle markiert)
- Erstes Befüllen überschreibt nie eine vorhandene Liste

## 0.1.84
- „Neue Podcast-Folgen“ aus den Podcast-Favoriten der gewählten Person; lädt sofort neu, wenn ein Podcast dazukommt

## 0.1.83
- Favoriten pro Person: jede Person (MA-Benutzer) hat eigene Favoriten auf der Startseite; beim ersten Öffnen mit den bisherigen Favoriten aus ihren Musikquellen befüllt
- In Music Assistant wird ein Favorit erst entfernt, wenn ihn niemand mehr hat
- Startseite: „Neue Podcast-Folgen“ per „↑ Ganz oben“ pro Person nach oben holen

## 0.1.82
- Suche startet erst nach 0,8 s Tipp-Pause (weniger Anfragen an Spotify & Co.)

## 0.1.81
- Logo oben links: Apps, die ihr eigenes Symbol liefern, zeigen dieses (sonst wie bisher)

## 0.1.80
- „Zuletzt gespielt“ aktualisiert sich bei jedem Öffnen der Startseite und jede Minute; zählt schon ab dem Start (nicht erst nach komplettem Hören)

## 0.1.79
- Überall die Quelle sichtbar: Tidal, Spotify [Konto], TuneIn, Radio Browser … (bei Bibliothek: wo der Eintrag liegt)

## 0.1.78
- Startseite „Zuletzt gespielt“: nur von der gewählten Person gestartet (Playlist/Album statt einzelner Titel)

## 0.1.77
- Startseite lädt höchstens alle 10 Minuten neu (Podcast-Folgen alle 30) – weniger Anfragen an Spotify
- „&amp;“ in Podcast-Namen korrigiert

## 0.1.76
- Startseite: Personen-Auswahl oben; Favoriten und Podcasts nur aus den Musikquellen der gewählten Person

## 0.1.75
- Startseite: Reihen lassen sich auch auf den Covern seitlich wischen; Kacheln etwas kleiner

## 0.1.74
- Neuer Aufbau wie bei Spotify: Startseite (Zuletzt gespielt, Favoriten, Empfehlungen, Meine Playlists, neue Podcast-Folgen)
- Player klappt aus der Mini-Leiste hoch; ⌄, Wischen nach unten oder Zurück klappt zu
- Untere Leiste: Start · Suche · Warteschlange

## 0.1.73
- Favoriten: Übersicht als Kacheln je Art (mit Cover-Collage und Anzahl); antippen = Liste mit Suchfeld

## 0.1.72
- ♥-Knopf oben rechts bei Playlist, Album, Künstler, Podcast; langes Drücken aufs Cover zuverlässiger (mit Rückmeldung)

## 0.1.71
- Neuer Reiter „Favoriten“ – nach Art sortiert (Playlists, Alben, Künstler, Titel, Podcasts, Hörbücher, Radio)
- Suche: Cover lange drücken = Favorit speichern/entfernen (auch das große Cover von Playlist, Album, Künstler)
- Großes Cover mit Titel darunter beim Öffnen von Playlist, Album, Künstler, Podcast

## 0.1.70
- Suche: Filter Radio, Podcasts und Hörbücher; Podcast antippen = Folgen (neueste zuerst)

## 0.1.69
- Einstellungen → Handy als Lautsprecher: zeigt das Übertragungsformat (FLAC/PCM), wenn die App es liefert

## 0.1.68
- Jukebox: Wiedergabe-Knöpfe kleiner, Lautstärke ohne Scrollen erreichbar

## 0.1.67
- TV-Ton jetzt im Menü des Mülleimers (Warteschlange) statt in der Knopfreihe

## 0.1.66
- Jukebox-Einstellungen: Schalter-Zustand aktualisiert sich (alle 5 s und beim Zurückkehren in die App)

## 0.1.65
- Jukebox: TV-Knopf rechts in der Knopfreihe, Knöpfe schrumpfen auf schmalen Handys statt aus dem Bild zu laufen

## 0.1.64
- Schalter auswählen: zuerst nur Helfer (input_boolean), die Suche findet auch alle anderen Schalter
- Anleitung: Schalter, TV-Ton und Liste leeren beschrieben

## 0.1.63
- Jukebox-Einstellungen: Versionsnummern ganz unten

## 0.1.62
- Jukebox: Knopf „TV-Ton“ für Lautsprecher mit TV-Eingang (z. B. Sonos Beam) – nochmal tippen = zurück zur Musik
- Jukebox-Einstellungen: „Schalter“ – ausgewählte Home-Assistant-Schalter direkt schalten (auch für die Android-Auto-App)

## 0.1.61
- Jukebox-Einstellungen: Versionsnummer von App und Add-on

## 0.1.60
- Neu: /party/presence – wer ist zuhause (Personen aus Home Assistant, nur Gastgeber)

## 0.1.59
- Jukebox: schwebender Knopf „Liste leeren“ in der Warteschlange (nur kommende Titel oder alles)

## 0.1.58
- Jukebox: Radio zeigt den laufenden Song (Titel, Interpret, Cover aus den Stream-Daten), Sender darunter; kein Fortschrittsbalken bei Radio

## 0.1.57
- TV-Ton: App-Logos weiß auf dunkler Fläche (DAZN war unsichtbar)

## 0.1.56
- TV-Ton: App-Logo (z. B. DAZN, Netflix, YouTube), wenn die App kein eigenes Bild meldet

## 0.1.55
- TV-Ton: App-Namen statt Paketnamen (z. B. „DAZN“ statt „com.dazn“)

## 0.1.54
- Jukebox: Läuft TV-Ton über eine Soundbar, werden Sender, Sendung bzw. App angezeigt (optional, neue Optionen „TV-Ton …“), mit Senderlogo

## 0.1.53
- Lautsprecher-Liste zeigt auch private Player (z. B. Handy mit der Music-Assistant-App)

## 0.1.52
- Einstellungen: „Handy als Lautsprecher“ (nur in Android-Apps mit dieser Funktion sichtbar)

## 0.1.51
- Jukebox auch über Home Assistant erreichbar (Seitenleiste „Jukebox“, unterwegs über Nabu Casa) – dort ohne Gastgeber-PIN, Home Assistant hat schon angemeldet
- Schnittstelle für Android-Auto-Apps (gewählter Lautsprecher und Profil)

## 0.1.50
- Profile: Technik-Konten (Dashboard-Anzeige, Gast, Kiosk) werden ausgeblendet
- Jukebox-Einstellungen → „Profile in der Suche“: festlegen, welche Benutzer angezeigt werden

## 0.1.49
- Jukebox → Suche: Profile aus den Music-Assistant-Benutzern („Musik von …“), pro Gerät gemerkt
- Ohne Suchbegriff: Playlists und Lieblingssongs des Profils; Suche und Abspielen nur über die für den Benutzer freigegebenen Musikquellen (z. B. eigenes Spotify-Konto)

## 0.1.48
- Jukebox-Einstellungen: „Projekt unterstützen“ (PayPal)

## 0.1.47
- Jukebox-Kopf: Lautsprecher-Auswahl wieder mittig (⚙ links neben dem Logo)

## 0.1.46
- Jukebox: Party-Logo mit Pfeil oben rechts führt zur Gäste-Seite

## 0.1.45
- Android-Apps 0.1.3 zum Herunterladen (Jukebox-App lässt sich von der Gäste-Seite aus öffnen)

## 0.1.44
- Gäste-Seite im Android-Browser: Jukebox-Logo öffnet die Jukebox-App (ab App 0.1.3), ohne App die Web-Jukebox

## 0.1.43
- Gäste-Seite: Zurück-Pfeil vor dem Jukebox-Logo

## 0.1.42
- Gäste-Seite: Knopf zur Jukebox jetzt nur als Jukebox-Logo

## 0.1.41
- Gastgeber-PIN (Jukebox → ⚙): Jukebox, Einstellungen und Vollzugriff auf Music Assistant nur nach PIN; Gerät bleibt angemeldet, nach 5 Fehlversuchen 1 Minute Sperre
- Gäste-Seite: Logo lange drücken → PIN-Abfrage → Jukebox; Knopf „‹ Jukebox“ nur auf angemeldeten Geräten
- TV-Anzeige und Gäste-Seite brauchen keine PIN (TV mit dem Add-on-Token nur noch lesend, wenn eine PIN gesetzt ist)

## 0.1.40
- Jukebox-Einstellungen → Gäste: „Gäste-Seite öffnen“
- Gäste-Seite: Knopf „‹ Jukebox“ oben – nur auf Geräten, auf denen die Jukebox schon geöffnet wurde (Gastgeber), Gäste sehen ihn nicht

## 0.1.39
- Gäste-Seite: Antippen des Suchfelds öffnet die Suche als Vollbild-Popup – Treffer direkt unter dem Feld, kein Scrollen mehr; „Fertig“ oder Zurück schließt
- Gäste-Seite lässt sich aus dem Browser als App installieren (eigenes Icon, Manifest, iPhone-Homescreen-Icon)

## 0.1.38
- TV-Anzeige im Spar-Modus lädt sich alle 90 Minuten beim Songwechsel kurz neu (Smart-TV-Browser geben Speicher sonst nicht frei)

## 0.1.37
- TV-Anzeige im Browser eines Smart-TVs (Samsung, LG, Hisense …): Spar-Modus automatisch an – behebt Abstürze nach dem Songwechsel
- Spar-Modus zusätzlich ohne drehende Platte, ohne Wechsel-Animation und mit kleinerem Cover (512 statt 1024 Pixel)

## 0.1.36
- Startseite: TV-App und Jukebox-App in Version 0.1.2 zum Herunterladen

## 0.1.35
- TV-Anzeige: deutlich weniger Grafikspeicher beim Songwechsel (unscharfes Cover-Hintergrundbild wird klein vorberechnet statt per Weichzeichner über den ganzen Bildschirm) – behebt Abstürze auf schwachen TV-Boxen
- Spar-Modus schaltet sich auf Geräten mit ≤ 1 GB Arbeitsspeicher automatisch ein
- TV-App 0.1.2: nach einem Absturz der Anzeige geht es automatisch im Spar-Modus weiter

## 0.1.34
- TV-Anzeige im Browser (Samsung, LG, PC): Hinweis „OK / Enter = Vollbild“, ein Tastendruck oder Klick schaltet auf Vollbild
- Neu im Repo: Samsung-App (Tizen) im Ordner `tizen-tv` mit Anleitung

## 0.1.33
- Song-Radio-Knopf (links): 2× tippen = ab dem laufenden Titel endlos ähnliche Musik (ersetzt die kommenden Titel), animiert solange aktiv

## 0.1.32
- Autoplay-Knopf rechts neben dem AI DJ, links nur Übergänge

## 0.1.31
- Autoplay-Knopf: ∞ bleibt als Zeichen erkennbar, wenn an pulsiert er leicht

## 0.1.30
- Jukebox: Audioqualität steht fest in der Mitte, Übergänge/Autoplay links, AI DJ rechts

## 0.1.29
- Jukebox: Cover in Playlists (und überall, wo MA Titel ohne Bild liefert) werden nachgeladen; Playlist ohne eigenes Bild bekommt das erste Titel-Cover

## 0.1.28
- Jukebox ⚙: Party-Name direkt in der App ändern (TV übernimmt ihn sofort, auch im Party-Plugin von Music Assistant)
- Autoplay-Knopf (∞, animiert): am Ende der Warteschlange hängt Music Assistant ähnliche Titel an

## 0.1.27
- Jukebox-Kopf: nur Logo + Lautsprecher, der Name der Box hat jetzt Platz
- Unter dem Titel: Übergänge an/aus (animiert), Audioqualität (HQ / Hi-Res / MP3 – antippen zeigt Format und Übertragungsrate), AI-Radio-DJ mit Moderator-Auswahl (animiert, nur wenn das MA-Plugin „AI Radio“ da ist)

## 0.1.26
- TV-Widmung: Cover des Songs statt Notensymbol, darunter Titel und Interpret

## 0.1.25
- Jukebox ⚙ → Party zurücksetzen: Getränke-Ranking bzw. Wünsche/Vordrängler leeren (mit Rückfrage)
- Getränke-Ranking verschwindet jetzt automatisch vom TV, wenn 12 Stunden nichts bestellt wurde (vorher erst bei der nächsten Bestellung)

## 0.1.24
- Jukebox in einer Android-App: Warteschlange (laufender + nächste 30 Titel) auch auf der Uhr und dem Sperrbildschirm, Titel dort antippen springt hin

## 0.1.23
- Nachschub-Benachrichtigung: mehrere notify-Dienste möglich (mit Komma trennen); auf dem iPhone mit Ton und als „zeitkritisch“, damit sie auch im Fokus-Modus durchkommt

## 0.1.22
- Jukebox: kurzer Einblender am Cover beim Antippen („🎤 Songtext“ / „🖼️ Cover“) und beim Favorit; die ersten drei Male erklärt er „Antippen: Songtext · Halten: Favorit“

## 0.1.21
- Jukebox: Cover kurz antippen → dreht sich und zeigt den Songtext mitlaufend (wie auf dem TV, gleicher Versatz); nochmal antippen = zurück zum Cover

## 0.1.20
- Anleitung: Abschnitt zu den Jukebox-Einstellungen (Räume, TV, Favoriten)

## 0.1.19
- Auto-Beitritt: nach einem Neustart des Add-ons wird erst beim nächsten Wechsel des Bewegungsmelders reagiert

## 0.1.18
- Räume · Auto-Beitritt (Jukebox ⚙): je Raum Lautsprecher + Bewegungsmelder wählen. Bewegung → die Box spielt die laufende Musik mit, ohne Bewegung wird sie nach einstellbarer Zeit wieder getrennt. Sperre per Schloss-Knopf (mit Restzeit), optional über einen eigenen HA-Schalter (z. B. für Alexa) und mit Zusatz-Bedingung. Bei TV-Ton an der Soundbar wird nichts verändert

## 0.1.17
- Jukebox: Cover lange drücken = laufenden Titel zu den Favoriten hinzufügen bzw. entfernen; Favoriten haben einen Rahmen im Farbverlauf

## 0.1.16
- Jukebox-Suche: Künstler, Alben und Playlists antippen öffnet sie (Titel, Alben, Titelliste); ⋯ bzw. die Knöpfe oben spielen alles ab. Zurück-Pfeil oder Zurück-Taste des Handys

## 0.1.15
- Jukebox: Teilnehmer-Laufband unter der Kopfzeile (wer gerade auf der Party-Seite dabei ist)
- Jukebox in einer Android-App mit Medien-Schnittstelle: Player in der Benachrichtigung/auf dem Sperrbildschirm, Steuerung über Lautstärketasten, Uhr und Bluetooth

## 0.1.14
- Jukebox ⚙ → Party-Plugin: direkt aus der App in Music Assistant installieren, ein- und ausschalten; Link „In Music Assistant öffnen“ für alle weiteren Plugin-Einstellungen

## 0.1.13
- Jukebox ⚙ → TV-Anzeige: Songtext-Versatz (in 0,1-s-Schritten) und Darstellung (Automatisch / Volle Optik / Spar-Modus) – wirkt sofort auf dem Fernseher, gespeichert im Add-on

## 0.1.12
- TV-Anzeige auf Android-TV-Boxen wieder in voller Optik (unscharfes Cover im Hintergrund, Animationen) – der Spar-Modus gilt automatisch nur noch für den Raspberry Pi

## 0.1.11
- Startseite: TV-App und Jukebox-App (APK, Version 0.1.1) direkt vom Add-on herunterladen

## 0.1.10
- Jukebox-Warteschlange: Titel am Griff ≡ an jede Stelle ziehen (statt nur Pfeil nach oben); bereits von MA vorgeladene Titel bleiben fest

## 0.1.9
- Jukebox: Zahnrad oben rechts → Party-Einstellungen: Lichteffekte an/aus, Abstimmung an/aus, Gast-Limits (Wünsche und Vordrängeln pro Gast, Nachfüllzeit) – die Limits werden direkt im Party-Plugin von Music Assistant gespeichert
- Jukebox: Einzelregler der Gruppe gehen nach oben auf, größerer Pfeil

## 0.1.8
- Lichteffekt-Skripte und Nachschub-Benachrichtigung funktionieren (Supervisor-Token wurde unter s6 nicht gefunden)
- Protokoll zeigt, ob Home Assistant erreichbar ist und welche Skripte ausgeführt wurden

## 0.1.7
- Jukebox: Lautstärke-Regler mit Punkt im Farbverlauf, Fortschrittsbalken des Titels ohne Punkt

## 0.1.6
- Jukebox: „Gruppe · N Lautsprecher“ antippen klappt einzelne Regler für jede Box der Gruppe auf

## 0.1.5
- Jukebox: Lautsprecher gruppieren – im Lautsprecher-Menü unter „Mitspielen mit …“ weitere Boxen zu- oder abschalten

## 0.1.4
- Cover wieder sichtbar (Jukebox-Suche, Warteschlange, TV, Party-Seite): MA-Imageproxy mit erlaubten Bildgrößen und proxy_id

## 0.1.3
- Jukebox: Bedienung funktioniert sofort nach dem Öffnen (vorher „Erst einen Lautsprecher wählen“, solange die Warteschlange noch nicht geladen war)

## 0.1.2
- Ungültige Music-Assistant-Adresse (z. B. vom Browser eingetragener Benutzername) wird ignoriert, MA wird dann automatisch gesucht

## 0.1.1
- Music-Assistant-Adresse darf auch ohne http:// und Port eingetragen werden (z. B. 192.168.1.10)
- Party-Player wird auch über den Anzeigenamen gefunden; Hinweis im Protokoll, wenn es ihn nicht gibt

## 0.1.0
- Erste Version: Jukebox (Web-App), Party-Seite für Gäste, TV-Anzeige
- Party-Logik im Add-on: Wünsche mit Widmung, Vordrängeln, Abstimmung (Skip bei Mehrheit), Nachschub mit Getränkewahl, Getränke-Ranking, Teilnehmerliste
- Music Assistant wird automatisch gefunden, Token einmal in den Optionen eintragen
- Kein Zugriff auf die Home-Assistant-API aus dem Browser
