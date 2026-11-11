# Recherche d’un chat récent

Le chat dicté « test » existait et avait une réponse, mais l’accès du relais à la liste complète ChatGPT renvoyait HTTP 429. La liste récente et la lecture directe du chat restaient disponibles.

Le relais recherche maintenant dans la liste récente uniquement lorsque celle-ci couvre toute la période utile ; il inclut les chats épinglés, filtre le projet et vérifie le texte initial et l’heure. Une couverture insuffisante, plusieurs correspondances ou une lecture indisponible ne doivent pas ouvrir un chat au hasard. La limitation de la liste complète reste active ; une limitation de lecture reste respectée.

Un essai en lecture seule avec le chat réel et un état temporaire a identifié le bon chat en maintenant la limitation de la liste complète ; aucun message n’a été renvoyé. Ce même essai a réussi avec le code 0.12.20 installé. La montre a également affiché le chat et sa réponse après reprise de l’application. Les parcours texte et dictée utilisent le même envoi après transcription ; la dictée peut activer la lecture automatique de la réponse. L’essai d’une nouvelle création complète reste à faire après installation.
