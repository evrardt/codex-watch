# Suivi de la voix Live Bluetooth 0.12.8

Un essai réel de la version précédente a encore produit des saccades. Les mesures de diagnostic sur la montre montraient des maxima de décodage de 173 à 244 ms et une attente dans la file qui a atteint plusieurs secondes. Les compteurs de manque de données peuvent inclure des périodes silencieuses et ne suffisent pas, seuls, à identifier chaque coupure.

Sur le même signal synthétique et la même Watch 7, un test a comparé successivement le décodeur natif, le décodeur Android et le décodeur natif. Les temps moyens par paquet de 20 ms étaient respectivement de 1,8 ms, 19,1 ms et 2,3 ms ; aucun paquet des deux passages natifs ne dépassait 20 ms. Les trois passages ont produit la durée attendue. Ce test n’établit pas à lui seul la qualité d’un appel réel.

La montre privilégie désormais libopus via Kopus, dont les licences sont incluses dans l’application, et revient au décodeur Android si le chargement natif échoue. Les messages du relais, la voix sélectionnée et le trajet du micro ne changent pas. Le décodeur est réinitialisé à chaque changement de flux ou de révision audio.

Sur la version 0.12.8 installée, un test synthétique a confirmé que le décodeur natif était actif, que la durée audio restait correcte avant et après réinitialisation et qu’une trame invalide était rejetée. Lors de l’essai Live Bluetooth, la personne a confirmé que la voix était fluide et que l’interruption fonctionnait. Les délais maximaux d’attente de la file mesurés sur quatre périodes étaient de 28, 17, 20 et 10 ms ; ces résultats ne garantissent pas la qualité dans toutes les conditions radio.

Les tests unitaires, les builds Android et `lintDebug` ont réussi. Pendant l’analyse de certaines tâches de test et de lint, Gradle affiche toutefois des messages de métadonnées Kotlin incompatibles : Kopus a été compilé avec Kotlin 2.2 et le projet utilise Kotlin 2.0. Le module Java isole la dépendance pour la compilation principale ; ces messages restent un point à résoudre pour les personnes qui maintiennent le projet.
