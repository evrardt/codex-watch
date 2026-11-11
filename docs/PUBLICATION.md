# Préparer une release GitHub

Le dépôt public est [evrardt/codex-watch](https://github.com/evrardt/codex-watch). Vérifier les liens et les fichiers de chaque release après sa mise en ligne.

1. Vérifier les versions de l’application Android et de `desktop/package.json`, les parcours d’installation, les captures et le README. Régénérer le guide HTML et exécuter les contrôles du projet.
2. Construire l’APK **release signé** avec la clé de signature durable du projet et l’installateur Windows correspondant. Conserver la clé et ses mots de passe hors du dépôt et de la release. Ne pas distribuer l’APK de débogage à la place.
3. Vérifier la signature avec `apksigner verify --verbose --print-certs`, la version et le fonctionnement des deux fichiers. Pour les mises à jour Android, utiliser la même clé de signature que la release précédente. Tester aussi l’installation depuis un téléphone Android.
4. Exécuter `node scripts/prepare-release.mjs <version>` pour assembler dans `.tools/releases/bundle-<version>/` l’APK, l’installateur Windows et `SHA256SUMS.txt`. Le script vérifie les versions et la signature avec les outils du SDK Android ; configure `ANDROID_HOME` ou `ANDROID_SDK_ROOT` et `JAVA_HOME` au besoin. Il refuse d’écraser un dossier de release existant. Il ne remplace pas les essais fonctionnels.
5. Créer la release dans le dépôt GitHub choisi, joindre les trois fichiers du dossier et rédiger les notes de version. Vérifier les téléchargements publiés et leurs empreintes.
6. Mettre à jour les liens de téléchargement du README et les instructions d’installation, régénérer le guide HTML, puis vérifier les liens depuis le dépôt public.

L’installateur Windows actuel n’est pas signé par un certificat d’éditeur ; le signaler tant que c’est le cas. Un fichier AAB peut servir à une distribution par store, mais ne remplace pas l’APK à installer directement.
