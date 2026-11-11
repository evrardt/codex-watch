# Vérification 0.12.38 — 10 novembre 2026

- Watch 7 : installation de développement mise à jour sans effacement des données. La montre a conservé le profil serveur. Les réglages Phonon et le curseur de vitesse ont été inspectés ; le texte OpenAI distingue la disponibilité audio du simple enregistrement d’une clé.
- Relais Windows : mise à jour installée, redémarrée après vérification de l’absence de demandes et de session Live en cours. Les états Codex et ChatGPT indiquent « Connecté ».
- APK release : installation de 0.12.37 sur l’émulateur puis mise à jour en 0.12.38 avec la même signature ; la date de première installation a été conservée. Le paquet, l’installateur Windows non signé et leurs empreintes sont dans `.tools/releases/bundle-0.12.38`. L’installation depuis un téléphone et sur un PC vierge restent à vérifier.
- Les 197 tests du relais et les 8 tests du bureau passent. Les audits npm ne signalent aucune vulnérabilité connue au moment du contrôle. Les listes de motifs privés ne remplacent pas une relecture des fichiers avant publication.
- Une question asynchrone réellement posée depuis le bureau n’a pas été détectée : le bureau a exposé une conversation active sans indicateur d’attente. Les questions bloquantes ne sont pas validées par cet essai ; la réponse aux formulaires natifs du PC reste à développer.
