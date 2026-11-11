# Vérifications de la version 0.12.40

- La version de développement est installée sur la montre Wear OS et le relais Windows ; Codex et Chat sont connectés.
- La détection des questions visibles sur le PC vérifie désormais tout le catalogue local, y compris les projets non autorisés, avant d’associer une question à un chat. Les titres en double et une pagination incomplète empêchent l’association ; ces cas sont testés. Le catalogue réel testé a été parcouru en moins d’une seconde. La réponse réelle depuis la montre reste à confirmer.
- La connexion Firebase a été renouvelée. Un test FCM a été accepté par Google et sa notification a été observée sur la montre Wear OS.
- 202 tests du relais passent. La construction Android et ses tests réussissent. L’APK release signé, l’installateur Windows non signé et leurs empreintes sont préparés localement ; ils ne sont pas publiés.
- La validation visuelle exhaustive des écrans, les essais audio matériels et les installations sur appareils vierges restent à terminer.
