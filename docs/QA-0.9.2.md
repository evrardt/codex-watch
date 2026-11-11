# Diagnostic Live et latence — relais 0.9.2

Correctifs du 8 novembre 2026. La montre reste en 0.9.1 (code 20) : ces changements sont appliqués au relais, sans réassociation ni nouvelle clé.

## Défauts reproduits

- Le Live recevait seulement les 900 premiers caractères de chaque message. Dans le chat signalé, la question pertinente était au-delà de cette limite : une réponse comme « les deux » perdait son sens.
- L’historique était placé en bloc JSON dans un message de configuration. Il est désormais transmis avec les rôles user/assistant prévus pour la reprise d’une conversation ; la fin des messages longs est conservée.
- Un test complet a montré que la voix pouvait répondre d’elle-même puis répéter le retour du chat natif. Les seules consignes n’étaient pas suffisantes : la lecture des nouvelles réponses est désormais bloquée jusqu’à l’injection d’un résultat vérifié. Les légendes et le journal suivent les échanges effectivement transmis à la montre.
- Le suivi ChatGPT réutilisait un cache de dix secondes. Les chats suivis activement et le Live utilisent désormais une fenêtre de 1,8 seconde, avec regroupement des lectures concurrentes et maintien de la temporisation en cas de limitation du service.
- Une ancienne réponse pouvait être prise pour le résultat d’une demande ultérieure. Le suivi cherche maintenant une réponse située après le message envoyé, ignore les historiques signalés anciens et remet les tours natifs dans leur ordre chronologique.
- Une attente supplémentaire de 1,6 seconde après la détection de fin de phrase a été retirée. Une consultation de statut reste une lecture et ne crée pas une demande dans le chat.
- La fermeture pour inactivité ne s’applique plus pendant un travail natif suivi. L’attente est affichée sur la montre, les erreurs de lecture temporaires sont retentées et les échecs répétés sont bornés. Les limites de durée et de dépenses restent en vigueur.

Le contrôle audio conserve aussi les premiers mots d’un résultat vérifié lorsque la voix les génère avant l’accusé d’injection du contexte. Les audio et légendes provisoires antérieurs restent bloqués.

## Mesures et essais

- 93 tests Node réussis, dont conservation d’une question après le caractère 900, historique typé, suivi de la bonne réponse, cache actif, absence de création de chat, maintien pendant l’attente et filtrage audio avant vérification et conservation des mots reçus avant l’accusé d’injection.
- Exécutable Windows empaqueté : connexion native, reprise après arrêt forcé, association unique, chiffrement et sélection des projets vérifiés dans un profil isolé.
- Watch 7 LTE physique : contexte ChatGPT existant et titre exact affichés avant Démarrer ; le microphone reste fermé pendant cette préparation.
- Essai vocal réel avec audio synthétique via HTTPS dans le chat concerné : reprise correcte de sa dernière question sans rappeler le sujet, session prête en environ deux secondes, aucun nouveau message ou chat créé pour cette consultation.
- Envoi natif de test : accusé du PC en 1,512 seconde ; le moteur ChatGPT a ensuite pris 40,6 secondes entre le début et la fin de son tour. Le premier sondage de 45 secondes n’avait pas encore observé la réponse ; une lecture native ultérieure l’a confirmée. Ce test ne garantit donc pas un délai total de 41 secondes sur la montre.
- Chaîne vocale vers un chat ChatGPT de test existant : demande transmise, réponse correcte reçue après environ 79 secondes, appel encore ouvert au-delà d’une minute. Cet essai a aussi révélé la réponse vocale prématurée, à l’origine du filtrage ajouté ensuite.

- Essai final après le correctif de conservation audio : voix → même chat Codex de test → résultat natif → lecture vocale « 1053 ». Session prête en 1,396 seconde, accusé à 14,745 secondes après ouverture, résultat à 18,831 secondes, aucune parole anticipée après le début de la demande. La transcription de la réponse vocale est présente. Le délai entre l’accusé et le résultat est donc d’environ 4,1 secondes ; le temps d’ouverture et de dictée n’est pas inclus dans ce chiffre.

Les essais audio utilisent une voix de synthèse en entrée et le vrai service Live ; ils ne constituent pas une nouvelle écoute humaine du haut-parleur ou du microphone. Aucun fichier ni compte externe modifié par les demandes de test. Les délais natifs varient suivant le chat et le service ; le relais ne peut pas imposer le modèle ChatGPT ou accélérer son raisonnement par le connecteur actuel.

Sources de conception : [historique et contexte Live](https://developers.openai.com/api/docs/guides/live-conversations), [délégation et contrôle de la parole](https://developers.openai.com/api/docs/guides/live-delegation).
