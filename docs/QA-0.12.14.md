# Notifications de réponse dictée

Une notification de fin de tâche est différée brièvement lorsqu’une réponse dictée doit être lue dans le chat ouvert. Elle est silencieuse seulement après confirmation du démarrage de lecture par Android. Si l’activité est quittée, la lecture échoue ou la confirmation n’arrive pas en 12 secondes, la notification est affichée avec son. Les autres chats, les erreurs et les demandes d’accord conservent leurs alertes habituelles. Les notifications FCM et directes partagent cette logique.

Une alarme Android persistante conserve l’événement si le processus est arrêté durant l’attente et émet alors une alerte sonore. Cette alarme est inexacte : Android peut la retarder en veille. Les paramètres de notification Android et les modes silencieux de la montre restent sous contrôle de l’utilisateur. Les tests unitaires simulent les chemins sonores et silencieux ; un test réel sur la montre reste nécessaire.
