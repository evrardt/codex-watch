# Vérification 0.12.34 — 10 novembre 2026

## Sur appareils

- montre Wear OS réelle : installation de la version de développement 0.12.34 sans effacement des données, accueil et profil serveur visibles ; une version antérieure a aussi été contrôlée dans les conversations, Live avant appel, réglages, demandes vides, modèles, plugins, voix et connexions.
- Émulateur Wear OS rond de petite taille : installation de l’APK release signé puis mise à jour signée ; écran initial, accueil, liste et conversation ; question à choix et approbation synthétiques depuis un relais isolé. La réponse « Automatique » et le refus ont atteint ce relais. Le même test a révélé un mot coupé et une description tronquée ; la taille des cartes a été corrigée et l’affichage vérifié de nouveau.
- Les tests synthétiques ne prouvent pas que les formulaires natifs d’une session Codex PC peuvent être validés à distance. Cette fonctionnalité dépend des interfaces du bureau et reste à traiter sur le PC.

## Installation et sécurité

- Relais PC : installateur Windows construit et vérifié en environnement isolé, association simulée et coffre testés ; version 0.12.34 installée sur le PC. L’installateur n’est pas signé par un éditeur.
- Relais VPS : installation vierge sous Ubuntu avec systemd utilisateur, création de mot de passe, association, liste et révocation vérifiées. Test d’administration locale avec origine HTTPS simulée ; ce test ne prouve pas à lui seul un parcours HTTPS public complet.
- Les fichiers de distribution préparés dans `.tools/releases/bundle-0.12.34` comportent un APK release signé et des sommes SHA-256. La clé Android est séparée du dépôt. Les données de l’installation de développement ne peuvent pas être conservées lors d’un remplacement par un APK signé avec une autre clé.
- Audits npm du relais et du bureau : aucune vulnérabilité connue à la date du contrôle ; la compatibilité des substitutions `minimatch` a été vérifiée sur Windows, pas sur Mac.

## Restant

L’inspection visuelle n’est pas exhaustive : états d’erreur, longs textes, tailles et langues variées, tous les écrans de configuration et toutes les demandes ne sont pas encore couverts. Les parcours radio et audio réels, la bascule PC/VPS, l’installation de l’APK depuis un téléphone, le GPU Phonon Linux et la vérification des livrables sur des ordinateurs vierges restent à compléter. Les essais précédents en Bluetooth réel ne remplacent pas cette matrice.
