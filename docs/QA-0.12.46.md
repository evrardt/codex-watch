# Vérifications de la version 0.12.46

- La question est affichée directement dans la conversation, sans cadre extérieur autour des cartes de réponses.
- Lors d’un essai réel, le PC fermait parfois le formulaire dès la sélection ; la montre affichait alors à tort que la demande n’était plus disponible alors que la réponse avait été reçue. Le relais vérifie désormais la présence d’une nouvelle réponse structurée correspondant exactement à la question et au choix avant de confirmer ce cas. Si cette preuve manque, l’envoi reste non confirmé et n’est pas répété automatiquement.
- Les tests vérifient que la disparition du formulaire, une ancienne réponse identique ou une réponse à une autre question ne suffisent pas à confirmer l’envoi. Un formulaire Windows isolé couvre aussi la sélection qui déclenche immédiatement une soumission.
- Après installation sur la montre Wear OS et le PC, une réponse réelle a été reçue ; l’utilisateur a confirmé le retour direct à la conversation après l’animation. La capture prise après cet essai montre la conversation sans message d’erreur. La notification, la présentation et l’état Bluetooth ont été vérifiés sur la configuration testée.
- La vérification reste limitée aux formulaires compatibles et aux appareils testés ; la revue visuelle exhaustive et les essais sur machines vierges restent à terminer.
