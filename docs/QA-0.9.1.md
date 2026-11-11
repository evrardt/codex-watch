# Correctifs et essais — 0.9.1

Vérifications du 8 novembre 2026. Cette version corrige les défauts signalés après la livraison 0.9.0. Elle reste un candidat à la distribution.

| Point | Résultat |
| --- | --- |
| Plugins HTTP 503 | Le processus de catalogue distant pouvait rester bloqué. Les appels sont bornés ; les marchés accessibles et les manifestes locaux fournissent une liste partielle. Les plugins seulement en cache sont indiqués « à vérifier », sans activation inventée. Le catalogue distant complet reste dépendant du service. |
| Plugins dans une réponse | Bouton Plugins près d’Envoyer, cinq sélections maximum. Sélection et retour au brouillon vérifiés sur Watch 7. Les noms sont transmis comme instructions explicites au moteur ; la connexion du compte externe reste nécessaire. Aucune installation automatique. |
| Modèles | Rafraîchissement des capacités réelles du PC à l’ouverture du sélecteur, cache de 60 secondes. Seuls les modèles et efforts exposés par l’hôte sont proposés. Les réglages ChatGPT restent ceux du PC. |
| ChatGPT HTTP 502 | La cause constatée était une limitation de lecture native, entretenue par des lectures de fond trop fréquentes. Suppression des relectures des chats inactifs, regroupement des demandes concurrentes, temporisation après limitation et instantané local explicitement signalé. Un historique natif a répondu 200 sans repli, puis son contenu a été affiché sur la montre. |
| Erreurs | Les messages structurés du service sont conservés. Une limitation ChatGPT ou une panne de catalogue ne prétend plus que tout le PC est hors ligne. Un véritable proxy inaccessible garde son message de connexion. |
| Live dans le chat ouvert | Le test audio réel a été transcrit et transmis dans le même chat Codex existant, sans copie. La question et PONG ont été vérifiés dans l’historique natif. La préparation Live sur Watch 7 montre le titre du chat ouvert avant Démarrer. |
| Échanges vocaux | Journal local lié à l’identifiant exact du chat, accessible par Échanges Live. Les demandes de travail rejoignent le chat natif ; les réponses purement orales restent dans ce journal. Cela ne reconstruit pas les anciens appels non enregistrés. |
| Relais Windows | Tout sélectionner/désélectionner, état partiel, compteur, Appliquer avec redémarrage automatique, erreurs persistantes, actions bloquées pendant l’application et expiration du code d’association. Le relais reste en zone de notification et repart après un arrêt inattendu du moteur. |

## Essais effectués

- 79 tests Node réussis, notamment accès aux projets, envois uniques dans le même chat, réponse en cas de limitation ChatGPT, catalogue partiel et délégation Live de secours.
- 21 tests JVM réussis ; compilation debug et lint sans erreur. Les avertissements de dépendances et API d’icônes restent présents.
- Exécutable Windows empaqueté testé dans un profil isolé : 15 projets détectés, tout sélectionner puis désélectionner, application des réglages, conservation de l’erreur lors du rafraîchissement, redémarrage après arrêt forcé, association unique, rejet du rejeu et clé chiffrée. Pas de débordement horizontal à la taille minimale testée.
- Watch 7 LTE physique : APK 0.9.1 code 20 installé avec conservation des données, plugins chargés sans 503, sélection retournée au brouillon, historique ChatGPT lisible et préparation Live dans le chat exact.
- Audio Live : 17 secondes de PCM de synthèse envoyées au vrai service, transcription reçue et demande transmise au chat existant. Le microphone physique et une écoute humaine n’ont pas été utilisés pour cet essai. Aucun fichier de projet ni plugin personnel modifié par la demande de test.

## Limites conservées

La disponibilité du catalogue distant et les limitations ChatGPT dépendent aussi du service natif. Un instantané local ne garantit pas un historique à jour. Les plugins en cache ne sont pas déclarés actifs sans confirmation. Les validations PC et le choix de modèle ChatGPT restent sur le bureau. Les essais présents ne remplacent pas une validation Play Store, multi-montres ou de consommation prolongée LTE. La publication publique et la signature d’éditeur Windows restent à organiser.
