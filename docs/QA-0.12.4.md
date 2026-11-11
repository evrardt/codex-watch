# Suivi du Live Bluetooth et des demandes Codex PC

## Live Bluetooth

La version 0.12.3 essayait de réduire les saccades en regroupant les écritures Bluetooth et en ajoutant une réserve de lecture. Après installation, un appel n’a pas transcrit la voix de l’utilisateur. Le relais a reçu des octets audio, sans que cela établisse qu’ils contenaient une voix intelligible : la cause de l’échec n’est pas encore démontrée.

La version 0.12.4 remet les composants de transport et de lecture du Live identiques à la version 0.12.2. Elle ajoute uniquement au relais un compteur de signaux d’activité sonore déjà émis par la montre, sans enregistrer le flux audio. Lors d’un nouvel essai sur la montre avec le Wi‑Fi et la 4G coupés, l’utilisateur a confirmé que le Live l’entendait à nouveau ; la voix reste légèrement saccadée. Les compteurs confirment la réception d’audio et d’un signal d’activité, sans établir la cause des saccades.

## Questions de Codex PC

Pour une question de test émise par `request_user_input_async`, le journal local de la session contenait les questions et leurs options avant la réponse, puis un message de réponse lié à l’identifiant de la question. Le connecteur de bureau utilisé par le relais n’a pas exposé cette carte dans son historique. Ces observations ne démontrent pas que tous les types de demandes sont détectables, ni que la carte peut être validée par un autre client.

L’inspection de l’interface Windows est bloquée : les contrôleurs ont échoué au démarrage avec « failed to write kernel assets » et une erreur de chemin introuvable, y compris après réinitialisation. Aucun mécanisme de réponse automatique n’a été activé. Avant toute intégration, vérifier la correspondance de la conversation et de la carte, le traitement des réponses multiples, l’expiration, la fermeture, le changement de fenêtre et la confirmation de la réponse. Ne pas utiliser l’historique local comme preuve suffisante qu’une carte est encore ouverte.
