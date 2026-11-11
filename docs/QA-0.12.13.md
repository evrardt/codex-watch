# Dictée et premier tour Live

La montre ajoute chaque dictée au brouillon modifiable avant l’envoi. La lecture automatique s’applique uniquement à une demande dictée et à une réponse identifiée après cette demande, tant que la conversation est ouverte ; elle peut être désactivée depuis la montre ou le relais. La reconnaissance utilise le service Android de la montre, pas un accès à la dictée intégrée de Codex PC.

En Live avec un plugin Codex, le relais attend la délégation du modèle vocal, puis peut transmettre la transcription après un délai si aucun événement de délégation n’arrive. L’opération du même tour est dédupliquée si le modèle émet ensuite une délégation tardive. En cas de réception incertaine, le relais ne renvoie pas automatiquement une opération. La transcription peut comporter des erreurs ; aucun test simulé ne garantit la reconnaissance ni le comportement d’un vrai modèle Live.

Les tests automatisés couvrent l’envoi de secours, une délégation tardive, une nouvelle intervention distincte, les erreurs de réception, les interruptions audio, la concaténation des dictées, l’association d’une réponse à la bonne demande et le réglage partagé. Un essai réel reste nécessaire sur la montre, notamment pour les interruptions et la lecture à la réception.
