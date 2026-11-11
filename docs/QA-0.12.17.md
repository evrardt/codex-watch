# Nouveau chat et limite temporaire ChatGPT

Un essai réel avec un nouveau chat ChatGPT a montré que le message avait été envoyé et que la réponse existait, alors que la montre restait sur la préparation. La lecture de l’historique était temporairement limitée côté ChatGPT ; elle doit rester distincte de l’envoi de la demande.

La montre affiche maintenant le message transmis dans une interface de conversation et indique l’attente de réponse. Si le relais signale une limite temporaire, le message explique que la synchronisation est en attente. Les intervalles de suivi respectent le délai signalé. Le relais conserve les listes déjà obtenues lorsqu’un rafraîchissement échoue ; il ne renvoie pas la demande pour contourner une limite et ne choisit pas un chat incertain.

Les tests couvrent le retour à une liste mise en cache, la remise à zéro du délai après une réponse réussie, l’affichage d’un délai et l’absence de requêtes répétées pendant ce délai. La version 0.12.17 a été installée sur le relais PC et sur la montre ; le fichier installé sur la montre correspond à l’APK compilé. Une nouvelle lecture indépendante a confirmé que la limite ChatGPT était encore active. L’ouverture finale d’un nouveau chat sur une vraie montre reste donc à vérifier une fois cette limite levée.
