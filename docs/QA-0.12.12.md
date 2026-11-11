# Live : conversation pendant une tâche de plugin

L’essai réel de la version 0.12.11 a lancé une seule demande à Codex. Blaster a lu ses consignes et exécuté ses outils, puis Codex a terminé. Après une demande orale d’être prévenu à la fin, le relais a traité à tort la réponse terminée comme périmée et annoncé deux fois qu’une demande n’avait pas été transmise.

La version 0.12.12 sépare la parole et la tâche en cours : tant qu’une tâche suivie ou une délégation est active, le relais ne bloque plus la conversation pour forcer une nouvelle délégation. Une simple intervention ne rend plus le résultat silencieux. Le résultat reste associé à son contexte ; la lecture attend la résolution d’une éventuelle nouvelle délégation et une demande remplacée utilise son nouveau suivi. Les interruptions ne sont pas des annulations. Le modèle vocal doit encore décider si une précision modifie le travail et réclame une délégation.

Les tests simulés couvrent notamment la demande d’avancement pendant une tâche, le résultat final entendu après cette intervention, une nouvelle délégation en attente, la substitution de demande et le changement de contexte. Ces tests ne prouvent pas l’expérience complète avec le service vocal : il reste à tester un appel réel, plusieurs interruptions, une correction de fond et le changement de contexte. La sélection native des plugins du compte ChatGPT reste distincte et non disponible ici.

## Essai réel de 0.12.12

L’utilisateur a demandé une analyse à Blaster, puis a parlé deux fois pendant la recherche. Le relais a enregistré une délégation, une soumission et un résultat vocal non silencieux. Le chat Codex confirme la lecture des consignes du plugin, l’appel de `prepare_debate` et `read_evidence`, puis une réponse finale sourcée. L’utilisateur indique que l’expérience semble fonctionner.

Deux limites restent visibles dans cet essai : la première formulation n’a pas produit de délégation et a dû être répétée ; la transcription vocale s’arrête à la fin de l’appel avant la fin de la réponse complète du chat, sans preuve suffisante pour déterminer si l’utilisateur a raccroché pendant la lecture. Les compteurs ne montrent aucune interruption explicite, donc cet essai ne valide pas les interruptions. Les tests automatisés restent distincts de ce contrôle réel.
