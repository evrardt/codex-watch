# Liste récente lente

Un essai réel a montré qu’une demande pouvait être créée et recevoir une réponse alors que la recherche attendait pendant 30 secondes la liste récente de l’application PC. L’ouverture restait donc bloquée malgré la réduction de l’intervalle entre les vérifications.

Le relais attend désormais au maximum 1,5 seconde la liste récente avant d’essayer la liste complète si elle est disponible. Les lectures de liste et de chat pour ChatGPT ont un budget global limité ; les requêtes déjà en cours restent regroupées. Les limitations du service et la vérification de l’identité du chat restent appliquées.

Les tests automatisés reproduisent la liste récente bloquée, ainsi que le blocage simultané des deux listes : le relais rend alors un état d’attente et regroupe les interrogations concurrentes. Un essai en lecture seule sur le chat réel, avec la liste récente simulée bloquée, a retrouvé le bon chat par l’historique en environ deux secondes sans renvoyer le message. Le temps de création et de réponse du service reste indépendant ; un nouvel essai réel complet depuis la montre reste nécessaire.

Après installation, le même essai de secours a rencontré une limitation HTTP 429 sur l’historique et est correctement resté en attente en environ 1,5 seconde. Cette limitation peut empêcher l’ouverture immédiate même avec le repli ; elle n’est pas contournée.
