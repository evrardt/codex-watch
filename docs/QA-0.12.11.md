# Live avec plugin : contrôle de la réponse

Un essai réel de 0.12.10 a confirmé que Codex avait appelé la recherche du plugin et consulté des preuves, puis que sa réponse était revenue dans le Live. Le modèle vocal a toutefois produit une réponse générique avant la délégation, malgré les consignes.

Avec un plugin sélectionné en contexte Codex, le relais retient désormais la sortie audio pendant la transmission de l’intervention et demande au modèle vocal de cesser sa réponse précédente avant de libérer le son. Le micro reste actif. Les salutations et commandes simples ne déclenchent pas ce contrôle. Si aucune délégation ne se produit, le relais sollicite le modèle puis indique l’échec au lieu de prétendre que le plugin a répondu. Le résultat peut toujours être reformulé par le modèle vocal ; les liens et la réponse complète restent dans le chat.

Les tests simulés couvrent la suppression de l’audio et de la transcription prématurés, la libération après confirmation, les salutations, l’interruption, l’absence de délégation, les changements de contexte et les réponses tardives. Une nouvelle vérification réelle avec le plugin reste nécessaire ; les tests ne garantissent pas que chaque modèle respecte parfaitement la procédure de chaque plugin. Les applications et plugins propres au compte ChatGPT ne sont pas encore sélectionnables depuis le relais.
