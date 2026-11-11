# Feuille de route : fiabilisation, installation et fonctions existantes

Cette feuille de route distingue le code préparé, les contrôles automatisés et les parcours validés sur des appareils réels. Les limites techniques et les licences restent documentées dans le guide.

## 1. Fiabiliser la version actuelle

- [x] Appliquer les corrections VPS précédentes après vérification des tâches en cours. Les fonctions récentes et la correction d’installation sont déployées.
- [ ] Vérifier les parcours complets sur la montre : la 0.12.46 de développement est installée. La bascule PC/VPS, une notification, la création d’un Chat VPS et la réponse à une conversation Codex VPS ont été vérifiées sur une version précédente ; les autres parcours restent à contrôler sur la nouvelle.
- [ ] Vérifier sur matériel réel la dictée, la lecture Phonon, le Live et les interruptions en Wi-Fi et en Bluetooth.
- [ ] Reproduire les erreurs restantes et corriger leurs causes avec des tests adaptés.

## 2. Rendre l’installation reproductible et préparer une publication

- [ ] Tester les parcours PC et VPS depuis un environnement vierge, APK compris, et actualiser le guide illustré à chaque changement visible. Le premier démarrage Linux et l’association ont été vérifiés sous Ubuntu ; le HTTPS externe et l’installation depuis téléphone restent à vérifier.
- [ ] Vérifier les licences, les secrets, les fichiers de l’export et les alertes de dépendances ; documenter les limites de sécurité.
- [ ] Préparer les livrables versionnés, leur signature et leurs sommes de contrôle ; vérifier que l’export est autonome.
- [ ] Ne publier un dépôt ou une release qu’une fois les résultats prêts à relire et la destination définie.

## 3. Compléter les fonctions existantes

- [ ] Compléter les questions et validations Codex PC : le relais Windows détecte désormais certains formulaires visibles dans le chat affiché, y compris lorsqu’aucun indicateur d’attente n’est fourni. La détection, une réponse à choix et une réponse libre ont été vérifiées depuis la montre ; les autres formats de formulaire restent à vérifier. Les validations sensibles restent sur le PC.
- [x] Préparer les accès individuels et leur révocation, compatibles avec le jeton partagé existant. La rotation de ce dernier reste une étape distincte.
- [ ] Compléter le diagnostic des liaisons ; préparer un suivi distinct et estimatif des dépenses Chat et audio, sans le présenter comme une limite de facturation garantie.
- [ ] Terminer la validation de l’installation GPU Phonon Linux sur un serveur NVIDIA vierge : l’installation CUDA et la sélection ont été intégrées ; le lecteur CUDA puis le repli CPU ont été vérifiés sous WSL. Le téléchargement réel du modèle a été vérifié séparément depuis le VPS, avec son empreinte ; le parcours complet doit encore être testé sur une machine NVIDIA vierge. Vulkan a utilisé le rendu logiciel llvmpipe ; AMD et Intel restent à traiter.

## Hors de ce périmètre immédiat

L’aide pendant une conversation et la version Mac finale nécessitent leur propre phase de conception et de validation matérielle. Voir [le rapport](RAPPORT-ETAT.md) et [l’étude d’écoute](ETUDE-ASSISTANCE-CONVERSATION.md).
