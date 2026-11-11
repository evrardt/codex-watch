# Disponibilité du Live — relais 0.9.3

Le 8 novembre 2026, la santé du relais indiquait Codex connecté, alors que l’ouverture Live renvoyait ready=false. Une lecture de la liste ChatGPT répondait HTTP 502 avec Too many requests. Le relais arrêtait alors son canal PC et toutes les listes parallèles échouaient ; l’interface demandait à tort de reconnecter Codex.

Le relais conserve désormais le canal PC lors d’une limitation ChatGPT, renvoie une erreur 429 explicite et partage une temporisation entre les lectures de liste et d’historique. Les projets sont mis en cache, les listes concurrentes regroupées et l’écran Live ne déclenche plus le chargement des conversations récentes. Sa disponibilité dépend de la connexion au PC et de la clé audio.

96 tests Node réussis, dont la chaîne d’erreur initiale, le maintien du transport et la disponibilité Live malgré une liste indisponible. L’exécutable Windows a également passé son essai isolé de démarrage, association unique et chiffrement. Aucun nouvel appel vocal facturé requis pour ce correctif. Montre 0.9.1 compatible, données conservées.

Après installation : le relais renvoie ready=true, Codex et ChatGPT connectés. Contrôle physique sur Watch 7 dans le chat Codex existant : Démarrer activé, absence du message de reconnexion et microphone fermé. La limitation ChatGPT observée initialement avait également cessé lors du contrôle final.
