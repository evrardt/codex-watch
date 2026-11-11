# Envoi Live après une phrase — relais 0.9.4

Le 8 novembre 2026, deux appels utilisateur comportaient une salutation et des transcriptions comme « Explique-moi plus simplement » et « Vas-y, continue », sans aucune opération d’envoi associée. Le moteur natif n’avait donc pas reçu ces demandes. Le serveur attendait un signal acoustique de fin de parole que la montre ne fournissait pas dans ces appels ; le modèle vocal n’avait pas non plus délégué spontanément.

Les transcriptions déclenchent désormais elles-mêmes une temporisation de 1,2 seconde, réinitialisée à chaque fragment. Après stabilisation, l’instruction rejoint le même chat même sans signal de la montre. Les délégations tardives restent dédupliquées. Le signal acoustique, s’il arrive, peut seulement accélérer ce déclenchement.

« Allô » et « Tu m’entends ? » obtiennent une réponse locale, sans créer ou remplacer une tâche. Le relais affiche immédiatement les phases de transmission et d’attente. Un échec connu de lecture ou d’envoi est expliqué à voix haute.

99 tests Node réussis : continuation dans un chat ChatGPT sans signal acoustique, assemblage des fragments avec pauses, envoi unique et contrôle local du micro préservant la tâche en cours. Cette correction est côté relais ; la montre 0.9.1 reste compatible.
