# Vérification 0.12.25

- Les tests de la connexion VPS vérifient la validation des entrées SSH et HTTPS, le refus d’une adresse injoignable et l’envoi du seul condensat du code d’association.
- Une connexion SSH réelle à un relais VPS existant a confirmé l’état du service et de Codex ainsi que la lecture des projets, sans transférer la clé privée.
- La page PC a été vérifiée avec des données fictives : les champs de configuration et le bouton d’association sont visibles, sans débordement horizontal.
- Le guide décrit l’installation préalable, les prérequis HTTPS et SSH et les limites de la page. L’association complète dépend d’une adresse HTTPS réellement accessible et doit être testée sur chaque installation.
- Sur une installation réelle, les connexions HTTPS aux trois adresses publiques ont renvoyé 401 sans jeton et 200 avec le bon jeton ; le certificat a été vérifié. Le Live sans jeton a aussi été refusé.
- Le code d’association a été accepté une seule fois et sa confirmation reçue. Un profil serveur a été enregistré sur une Watch 7 avec un jeton chiffré par une clé du Keystore ; le profil PC a été rétabli et les fichiers temporaires ont été supprimés.
- Ces essais ciblés vérifient les chemins exercés ; ils ne constituent pas un audit de sécurité complet.
