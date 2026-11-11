# Installation avancée et développement

## Construire depuis les sources

Prérequis : Java 17, SDK Android 35, Node.js 22 ou plus récent. Le wrapper utilise Gradle 8.9.

```sh
./gradlew :wear:assembleDebug :wear:testDebugUnitTest :wear:lintDebug
cd bridge
npm ci
npm test
cd ../desktop
npm ci
node node_modules/electron/install.js
npm start
```

Sur Windows, `npm run dist` dans `desktop` génère l’installateur NSIS. Les dépendances du relais doivent être installées avant l’empaquetage. Les sources de développement comprennent un module `pairing` d’instrumentation ; il n’est pas installé pour l’usage normal.

Pour une production Android signée, définir `WATCH_KEYSTORE`, `WATCH_STORE_PASSWORD`, `WATCH_KEY_ALIAS` et `WATCH_KEY_PASSWORD`, puis exécuter `:wear:assembleRelease :wear:bundleRelease`. Ne jamais ajouter de clé de signature au dépôt. Les builds de développement existants utilisent leur propre signature.

## Relais autonome et configuration avancée

Le moteur `desktop` emploie le connecteur app-tools livré avec Codex sur Windows. Cette interface peut évoluer ; le relais attend la reconnexion du bureau et ne bascule pas vers un second moteur. Le contexte d’association est déduit des métadonnées locales d’un chat existant. Le moteur `standalone` lance `codex app-server` avec l’authentification de sa machine et possède ses propres chats.

Pour installer et administrer le relais sans application Windows, suis le [guide VPS](INSTALLER-VPS.md). L’interface web a un code administrateur distinct du jeton de la montre. Les données sont dans `~/.local/share/codex-watch-vps/data`, et la clé API du Chat, si configurée, dans `openai-api-key.txt` avec des permissions privées. L’API est facturée ou déduite des crédits de l’organisation de la clé ; le budget audio ne limite pas le Chat. L’historique reste sur le serveur et les conversations, projets et plugins du site ChatGPT ne sont pas importés. Le modèle par défaut est `gpt-6.1-terra` ; `apiChatModel` permet de changer de modèle compatible Responses dans `data/config.json` avant redémarrage. La configuration Live reste distincte.

### Consultation des services d’un serveur

L’accès aux services ne découle pas automatiquement de l’association. Sur un serveur configuré pour cela, `server-tools/codex-watch-services.py` fournit l’inventaire Docker et peut démarrer, arrêter ou redémarrer un conteneur ou un service système identifié précisément. Certains services critiques sont protégés. L’outil ne donne pas au relais l’accès direct au socket Docker, aux journaux, aux commandes internes des conteneurs ou à leurs fichiers de configuration. `server-tools/refresh-inventory.py` actualise un fichier lisible par le Codex isolé ; les instructions de `server-tools/AGENTS.md` décrivent ce fichier. Ces outils ne constituent pas encore un installeur universel : leur configuration est manuelle et dépend de l’hôte.

Sur Ubuntu, si les commandes Codex échouent avec une erreur Bubblewrap ou de création d’espace de noms, vérifier la [documentation officielle du bac à sable](https://developers.openai.com/codex/concepts/sandboxing#prerequisites). Une exception AppArmor doit viser un exécutable Bubblewrap appartenant à root et une configuration adaptée à la distribution, plutôt que désactiver globalement la protection. `server-tools/apparmor-codex-watch` est un exemple ciblé, à adapter et à vérifier avant usage ; il ne s’active pas automatiquement.

Les approbations du moteur Codex sont disponibles dans **Demandes** sur la montre pour les interactions prises en charge. L’exécutable privilégié et sa règle sudoers doivent appartenir à root. Le script privilégié **ne vérifie pas lui-même les validations** : ne pas installer ses fonctions de modification sans bac à sable fonctionnel, configuration des approbations et vérification de l’isolement du compte. Ne pas donner au relais l’accès direct au socket Docker ni à un `sudo` général. La sécurité dépend aussi du jeton d’association : tout client possédant ce jeton peut envoyer des demandes et répondre aux validations du relais.

Les données privées et jetons sont conservés dans le dossier utilisateur de l’application Windows ou dans `WATCH_DATA_DIR`. La première version en mode développeur utilisait `.local`. Aucun historique, clé, jeton Firebase ou fichier propre à une machine n’est fourni dans les sources publiques. La configuration FCM d’un opérateur est facultative ; aucun service de notifications mutualisé n’est inclus dans cette distribution.

### Notifications Firebase facultatives

Les notifications directes ne demandent pas de projet Google. Elles reposent sur une connexion maintenue avec le relais et peuvent être retardées par la veille de la montre. Pour utiliser FCM, il faut un projet Firebase personnel, son application Android correspondant au paquet de la montre et des identifiants d’envoi configurés côté relais. Le fichier [firebase.example.json](firebase.example.json) montre les paramètres publics attendus. Cette configuration reste avancée et n’est pas encore proposée par un assistant dans l’interface.

Un compte de service dédié disposant uniquement du droit `cloudmessaging.messages.create` évite de dépendre d’une connexion Google personnelle. Le relais renouvelle automatiquement les jetons d’accès de courte durée à partir de ses identifiants ; la clé privée du compte de service, elle, n’est pas renouvelée automatiquement. Si elle expire, est révoquée ou doit être remplacée, un administrateur doit la renouveler et actualiser la configuration. Ne partage jamais cette clé, ne l’ajoute pas au dépôt et limite l’accès à son fichier au compte exécutant le relais et aux administrateurs de la machine. Les politiques de ton organisation Google peuvent interdire la création de clés ; seul son administrateur peut décider d’une éventuelle exception limitée.

Voir [Contribuer](../CONTRIBUTING.md), [Sécurité](../SECURITY.md), [Changements](../CHANGELOG.md) et [Préparer une release](PUBLICATION.md).
