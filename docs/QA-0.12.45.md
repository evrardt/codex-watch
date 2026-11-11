# Vérifications de la version 0.12.45

- Le Bluetooth démarre dès le lancement du processus du relais, sans attendre que Codex réponde au contrôle de santé. En cas d’échec, il reste soumis aux nouvelles tentatives automatiques de la version précédente.
- Les propositions et leurs descriptions ne sont plus limitées à quelques lignes. La demande reste affichée pendant l’envoi ; une réponse confirmée ne peut pas réapparaître à cause d’une ancienne réponse de synchronisation. Une erreur non confirmée reste visible jusqu’à ce que l’utilisateur quitte la conversation ou réessaie.
- Les nouveaux scénarios de synchronisation couvrent une demande en cours, une réponse confirmée suivie d’une ancienne mise à jour, et une réponse non confirmée. L’utilisateur a confirmé sur la montre qu’une proposition longue était lisible jusqu’à sa fin. Il a toutefois signalé qu’un problème subsiste dans le retour à l’envoi : ce point reste à diagnostiquer et corriger.
- Les essais réels sur l’historique volumineux et les limites précédentes sont décrits dans [QA-0.12.44](QA-0.12.44.md).
