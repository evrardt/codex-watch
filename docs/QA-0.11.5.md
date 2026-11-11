# Association et clé audio

Le relais affiche désormais « Code accepté » après l’échange initial, puis « Association réussie » uniquement après la vérification et l’enregistrement de la connexion par la montre. Un accusé de réception à usage unique relie les deux étapes. Une confirmation perdue est signalée sans être présentée comme une réussite.

Sur la montre, la validation du clavier lance l’association et le champ de code n’est plus rempli par un ancien jeton masqué. Une connexion existante est conservée si le champ reste vide lors d’une modification de l’adresse.

Dans « Voix et budget », l’interface indique si une clé est enregistrée et chargée par le relais. Le bouton « Afficher la clé » la révèle localement à la demande, puis la retire du champ après 30 secondes, lorsque la fenêtre perd le focus ou lors d’un changement de page. Un remplacement vide ne supprime pas la clé ; une modification arrête puis redémarre le moteur sans changer la clé pendant un appel Live.

Validation : 117 tests Node, 24 tests JVM, lint Android sans erreur (9 avertissements). Un test du paquet Windows a exercé la génération d’un code, son acceptation, la confirmation authentifiée et l’affichage du succès. L’affichage et le masquage ont été testés avec une clé fictive. La clé réelle n’a pas été affichée dans les journaux ni dans les résultats des tests.
