# Änderungen

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
