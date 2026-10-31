# Lichteffekte für die Party-Jukebox

Drei fertige Home-Assistant-Skripte. Die Lampen, die gerade **an** sind, blinken kurz und gehen danach
genau in ihren vorherigen Zustand zurück (Farbe, Helligkeit, an/aus).

| Datei | Wann | Effekt |
|---|---|---|
| `party_licht_wunsch.yaml` | neuer Songwunsch | 2× pink → violett → türkis |
| `party_licht_vordraengler.yaml` | jemand drängelt sich vor | 3× rot/orange (Warnlicht) |
| `party_licht_nachschub.yaml` | Getränk bestellt | 2× gelb/orange |

## Einrichten
1. In Home Assistant: **Einstellungen → Automationen & Szenen → Skripte → Skript erstellen**.
2. Oben rechts **⋮ → In YAML bearbeiten**, den Inhalt einer Datei komplett einfügen.
3. In der Zeile `['light.LAMPE_1', 'light.LAMPE_2', 'light.LAMPE_3']` deine Lampen eintragen
   (Entity-IDs findest du unter Einstellungen → Geräte & Dienste → Entitäten, z. B. `light.wohnzimmer_decke`).
4. Speichern – als Skript-ID am besten `party_licht_wunsch`, `party_licht_vordraengler`, `party_licht_nachschub`.
5. Im Add-on unter **Konfiguration** eintragen:
   - Skript bei Wunsch: `script.party_licht_wunsch`
   - Skript bei Vordrängeln: `script.party_licht_vordraengler`
   - Skript bei Nachschub: `script.party_licht_nachschub`

## Hinweise
- Nur Lampen mit Farbe (RGB) zeigen die Effektfarben; reine Weiß-Lampen werden einfach heller.
- Lampen im **Hue-Sync**-Betrieb (Fernseher-Sync) werden automatisch ausgelassen.
- Ausprobieren: Skript öffnen → **Ausführen** (vorher ein paar der Lampen einschalten).
