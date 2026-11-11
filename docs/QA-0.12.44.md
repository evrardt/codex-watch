# Vérifications de la version 0.12.44

- Une conversation Codex PC réelle renvoyait HTTP 502 : sa lecture de dix tours dépassait la taille maximale du connecteur. Le relais réduit désormais progressivement la taille des pages uniquement pour cette erreur, sans répéter les autres erreurs. Une lecture isolée a récupéré 124 messages récents de cette conversation, puis 186 messages après lecture d’une page plus ancienne. Après installation, l’utilisateur a confirmé que les messages sont de nouveau visibles sur la montre.
- Si un tour unique reste trop volumineux, le relais peut réduire les détails par élément et affiche un avertissement dans la conversation. La lecture par pages reste disponible lorsque le connecteur fournit un curseur.
- Sur la montre, l’appui sur l’envoi déclenche immédiatement un retour tactile et affiche « Envoi… » avec un indicateur ; la confirmation de réussite n’apparaît qu’après validation par le relais. La vérification physique de cette dernière version reste à effectuer.
- Les essais Bluetooth, de réponse libre et de redémarrage du relais de la version précédente figurent dans [QA-0.12.43](QA-0.12.43.md).
