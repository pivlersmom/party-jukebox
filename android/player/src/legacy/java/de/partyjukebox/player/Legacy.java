package de.partyjukebox.player;

/**
 * Übernahme früher fest eingebauter Werte beim ersten Start.
 * In der öffentlichen Version leer – eine eigene Version kann diese Datei beim Bauen durch eine mit
 * ihren alten Werten ersetzen (z. B. aus einem privaten Repository), damit niemand neu einrichten muss.
 */
final class Legacy {
    static final String HOME = "";
    static final String REMOTE = "";
    /** frühere feste Zuordnung Profil (MA-Benutzer) → Person; leer = in der App einstellen */
    static String mePerson(String user) { return ""; }
    /** früher: Podcast-Vorschlag im Auto für dieses Profil */
    static boolean podcastUser(String user) { return false; }
    private Legacy() { }
}
