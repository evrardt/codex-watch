# Fluidité — vérifications

Sur la montre Wear OS, un relevé initial sur un chat déjà utilisé, avec quatre allers-retours de défilement, indique 206 images, 17,96 % d’images considérées comme saccadées, une médiane de 19 ms et un 95e percentile de 48 ms. Cette courte mesure dépend des interactions et de l’état de la montre : elle ne prouve pas à elle seule l’origine de toutes les lenteurs.

Le relais fournit désormais un validateur HTTP pour les chats inchangés : après authentification, une nouvelle lecture identique ne retransmet pas le contenu. La montre conserve le même objet et évite une mise à jour Compose et un nouveau décodage JSON dans ce cas, avec repli compatible sur les relais précédents. Le formatage Markdown évite de recopier tout le texte à chaque paragraphe ou lien. La surveillance des projets ne relit pas immédiatement un chat déjà lu pendant le même cycle ; le suivi conserve sa fréquence. La fenêtre PC n’actualise son interface que lorsqu’elle est visible et se rafraîchit dès sa réouverture. Le réglage de lecture automatique est accepté par le relais PC.

Le modèle Phonon peut mobiliser une quantité importante de mémoire quand l’option de maintien ou de préchargement a été activée ; les réglages de l’utilisateur restent inchangés. Les essais couvrent les réponses conditionnelles, l’authentification, les changements de messages, les notifications de fin, le formatage et les préférences audio. Une nouvelle mesure réelle reste nécessaire après installation.

## Mesures après installation

Pour le chat mesuré, la première réponse du relais contient environ 5 701 octets ; une relecture inchangée reçoit une réponse HTTP 304 sans corps. Sur la montre, un premier défilement juste après installation a donné 112 images et 59,82 % d’images irrégulières. Après chargement, un second défilement comparable a donné 198 images, 17,68 % d’images irrégulières, une médiane de 20 ms et un 95e percentile de 46 ms. Le relevé initial était de 206 images, 17,96 %, médiane 19 ms et 95e percentile 48 ms. La variabilité et la brièveté de ces essais ne permettent pas de conclure que la fluidité générale s’est améliorée ; le démarrage à froid reste à améliorer.

Les tests du relais passent (157 tests), de même que les tests et le contrôle Android. Un test Electron isolé vérifie l’absence de rafraîchissement pendant le masquage, la reprise au retour et la commande de lecture automatique. Les réglages de préchargement et de maintien en mémoire de Phonon ont été conservés ; le modèle est de nouveau chargé sur le GPU.
