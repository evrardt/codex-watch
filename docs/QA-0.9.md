# Rapport UI/UX et livraison — 0.9.0

La version 0.9.0 regroupe le Live et les fonctions de gestion dans une interface cohérente menthe/lilas. Les paquets sont des **candidats à la distribution**, pas des applications déjà acceptées par un store. Les accès de publication ne sont pas fournis avec les sources.

| Demande | Résultat et vérification |
| --- | --- |
| Préparer le Live avant l’appel | Démarrage manuel, ChatGPT par défaut, contexte et projet accessibles avant Démarrer. Vérifié sur Galaxy Watch 7 et émulateur Wear OS. |
| Nouveau chat depuis l’accueil | Création différée à la première instruction utile ; une seule création, puis réutilisation de l’identifiant. Tests du relais avec délégations et accusés incertains. |
| Conserver un chat ouvert | Identifiant exact transmis à Live ; pas de copie, pas de second propriétaire de chat. Tests de routage et d’idempotence. |
| Son plus fort | Sortie média, gain de parole avec limiteur doux, sans modifier le volume global. Tests PCM ; l’appréciation du volume sur la dernière version reste à confirmer par une écoute humaine. |
| Animation | Énergie du microphone et du PCM effectivement lu, lissage, respiration au repos et état micro coupé. Vérification du code et du cycle de lecture ; pas de nouvel appel payant imposé pendant les essais de distribution. |
| Accueil sur une ligne | Live, ChatGPT et Codex sur la même ligne. La première passe tronquait ChatGPT ; largeur et marges corrigées, puis contrôlées par capture. |
| Boutons courts | Démarrer, Reprendre, Live, Associer, Précédents, Activer. Les boutons d’action imposent une seule ligne. Le message « Prêt quand tu veux » est supprimé. |
| Live en bas des conversations | Deux commandes fixes distinctes : réponse/consigne et Live. Icônes de 48dp et libellés courts. Elles restent disponibles pendant le défilement. |
| Modèle et réflexion | Catalogue réel de l’hôte, validation des efforts et transmission aux envois Codex, y compris Live. Tests refusant les combinaisons indisponibles. ChatGPT garde ses réglages PC. |
| Plugins | Liste installée et catalogue réel, recherche et pages de 30 résultats, confirmation avant modification. Le catalogue complet est volumineux et n’est pas envoyé à la montre. Activation vérifiée dans un profil isolé ; aucune installation ni suppression réelle de plugin personnel effectuée comme test. |
| Demandes et accords | Questions et décisions une seule fois pour le moteur autonome, expiration et nettoyage des demandes résolues. Le connecteur PC ne fournit pas de commande de réponse : cette limite est affichée et les validations restent sur le PC. |
| Quota | Jauge USD : disponible, utilisé, provisions et plafond. Suppression des longs paragraphes de calcul dans l’interface. Réservation durable et retour à la voix système au plafond couverts par les tests. |
| Relais installé | Interface Windows, zone de notification, projets, coffre système, assistant HTTPS et association temporaire. Test de l’exécutable empaqueté avec un profil isolé : détection, santé Codex, code unique, rejet d’une seconde utilisation et chiffrement de clé. |
| Sources et publication | Licence MIT, documentation publique, CI, politique de confidentialité, dossier store, export filtré et paquets signés Android. Aucun secret de machine ni certificat privé ne doit entrer dans l’archive publique. |

## Vérifications

Contrôle du 8 novembre au matin : la montre a été relue par ADB et son APK est identique au dernier build 0.9.0 (code 19). Le profil PC est conservé. Un arrêt du moteur du relais avec la fenêtre encore ouverte a été constaté ; une reprise automatique et un arrêt définitif des connexions à la fermeture ont été ajoutés. Un essai isolé avec arrêt forcé a confirmé le redémarrage automatique du moteur, puis son arrêt normal. Les erreurs sont désormais consignées dans le dossier de données du relais installé.

- Relais : **75 tests Node réussis**, dont autorisation des projets, même chat, non-répétition des envois, quotas, demandes et association.
- Montre : **20 tests JVM réussis**, compilation debug et production, contrôles lint sans erreur. Les avertissements restants concernent principalement les versions de dépendances, des écritures synchrones intentionnelles et la navigation des notifications.
- Le Live avait déjà été essayé avec voix et transcription par l’utilisateur. Les modifications de distribution sont contrôlées sans nouvelle demande de travail ni modification de plugin sur son compte.
- Paquet Windows testé indépendamment des sources : un premier essai a révélé une dépendance absente de l’archive ; l’empaquetage a été corrigé et le démarrage réel retesté.
- La montre physique peut couper son débogage Wi-Fi. Les essais d’interface supplémentaires utilisent donc aussi un émulateur Wear OS rond.

## Limites avant une diffusion générale

1. Les validations interactives du **moteur PC** et le réglage du modèle **ChatGPT** ne sont pas exposés par son connecteur actuel. Les simuler sur la montre donnerait une impression trompeuse de prise en compte ; ils restent explicitement sur le PC.
2. Les connexions OAuth propres aux plugins se terminent sur le PC. Installer ou activer un plugin ne donne pas automatiquement accès à ses comptes externes.
3. La diffusion FCM mutualisée n’est pas fournie à tous les utilisateurs. Un opérateur configure son propre projet ; le mode direct est disponible et consomme davantage de batterie.
4. Les contrôles de grande police, du geste de retour, de l’accessibilité complète, de la plus petite taille ronde 192dp, de plusieurs modèles de montres et d’une utilisation prolongée Wi-Fi/LTE doivent être complétés sur le canal de test du store. Les essais présents ne valent pas une validation Google Play.
5. La lecture humaine du volume final, les sessions Live longues et la consommation en veille restent à mesurer sur plusieurs appareils. Les appels sont bornés et le micro est arrêté à la sortie.
6. L’installateur Windows n’a pas de certificat de signature d’éditeur. Les builds macOS/Linux graphiques ne sont pas livrés ni validés ; les sources du relais autonome sont disponibles.
7. La publication demande un compte GitHub connecté, une identité et un compte Play Console, un contact de confidentialité public, une URL stable et les validations du store. Les documents préparés ne remplacent pas ces étapes.

Référence utilisée pour la préparation : [exigences Wear OS](https://developer.android.com/docs/quality-guidelines/wear-app-quality). Le dossier [STORE.md](STORE.md) précise les éléments à fournir au compte éditeur.
