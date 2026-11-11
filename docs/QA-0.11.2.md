# Démarrage et accès au relais Windows

L’icône de notification ouvre désormais la fenêtre par un simple clic. Son menu distingue l’ouverture de « Quitter et arrêter le relais ». La fenêtre explique que sa fermeture laisse le relais actif et que quitter coupe la connexion de la montre. Elle indique l’état réel et présente les actions adaptées à cet état.

Une nouvelle ouverture de l’application redémarre aussi un relais arrêté dans l’instance existante. Le service démarre indépendamment de la création de l’icône ; si le coffre audio ne peut pas être déchiffré, les fonctions Codex et ChatGPT démarrent et une indication demande de vérifier la clé audio. La clé chiffrée est conservée. La fenêtre dispose également d’un délai de secours pour son affichage.

Validation : deux démarrages complets successifs du paquet avec fermeture par `app.quit()` dans un profil isolé doté d’une copie du profil chiffré ; serveur sain et fenêtre visible aux deux lancements. Un profil sans accès au coffre démarre le relais et affiche l’avertissement attendu. Trois cycles de fermeture et recréation de fenêtre, récupération après plantage du rendu, redémarrage du moteur et association ont également réussi. Les 114 tests Node passent.

Après installation sur le PC, le relais répond, Codex et ChatGPT sont connectés et la clé audio est disponible. Le clic réel dans la zone de notification n’a pas été automatisé, car l’outil de contrôle Windows n’a pas pu initialiser son environnement ; le parcours a été exercé par les tests Electron. La cause exacte de l’arrêt observé chez l’utilisateur n’a pas été établie.
