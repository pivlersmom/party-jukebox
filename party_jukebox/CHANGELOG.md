# Änderungen

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
