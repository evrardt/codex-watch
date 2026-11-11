# Vérifications de la version 0.12.39

- La version de développement est installée sur la montre Wear OS sans effacer ses données ; le relais Windows mis à jour est démarré. Ses états Codex et Chat sont connectés.
- Une question native réellement affichée dans Codex a été détectée avec ses choix par le relais installé. Sur une fenêtre Windows isolée, la sélection d’un choix et l’envoi d’un texte ont été vérifiés. Un formulaire modifié et un brouillon déjà saisi sur le PC empêchent l’envoi.
- Le test de réponse de bout en bout depuis la montre reste à effectuer. La lecture ne couvre que certains formulaires du chat affiché ; elle refuse les cas ambigus. Les approbations sensibles restent sur le PC.
- 201 tests du relais et 8 tests du bureau passent ; la construction Android et ses tests passent. Les audits npm ne signalent aucune vulnérabilité connue lors du contrôle.
- L’APK release est signé ; l’installateur Windows ne l’est pas. Leurs empreintes figurent dans le dossier local de release. Aucun livrable n’a été publié.
- Les notifications Firebase du PC demandent une nouvelle authentification avant de pouvoir confirmer leur fonctionnement en arrière-plan. Les contrôles de tous les écrans, les parcours sur appareils vierges et les essais matériels audio restent incomplets.
