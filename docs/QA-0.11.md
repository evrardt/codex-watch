# Validation 0.11.0 — propriété du dialogue Live

Vérifications du 8 novembre 2026. Lire [l’audit complet](AUDIT-LIVE.md) pour le diagnostic, les choix et les écarts encore ouverts.

## Vérifications de code et compilation

- **114 tests Node réussis**. Régressions : aucune relance ou soumission sur transcription/silence seul, interruptions successives, déduplication des délégations, instructions distinctes en attente, contexte oral capturé avant une lecture lente, résultat devenu ancien, dernier choix de contexte prioritaire, inactivité malgré les paquets silencieux, budget Live insuffisant et surveillance d’un moteur bloqué.
- **24 tests JVM réussis**, APK de développement construit, lint Android : **0 erreur, 9 avertissements**.
- APK de production et bundle Android signés construits avec la clé existante. L’installateur Windows est construit sans publication et sans certificat d’éditeur.
- Paquet Windows final testé dans un profil isolé : interface récupérée après plantage volontaire du processus d’affichage, même moteur sain conservé ; moteur redémarré après arrêt volontaire ; association temporaire consommable une seule fois et chiffrement de clé confirmés. La panne d’un moteur vivant mais bloqué est couverte par les tests du surveillant, distinctement de cet essai de processus arrêté.

## Essais vocaux réels

Les stimuli sont des phrases synthétiques envoyées dans un **flux PCM continu** au vrai service Live via le relais HTTPS. Les fichiers WAV servent uniquement à générer les entrées du banc d’essai ; l’application ne fonctionne pas par envoi de fichiers vocaux séparés.

Trois essais ont comparé le contexte importé :

1. Suppression des relances automatiques : quatre interruptions fonctionnent, mais un ancien résultat du chat est récité au début de la première demande.
2. Ajout d’une instruction de séparation après l’historique : le même défaut reste observable. Cette variante a été écartée.
3. Historique représenté comme archive : **75 secondes, une session, quatre interruptions, zéro délégation native, zéro relance après silence et aucun ancien calcul récité**. Les sujets vélo, jardinage, volcans et cuisine sont remplacés successivement, puis le bot répond « Orange » à la dernière correction. Les tampons sont vidés à chacune des quatre interruptions. Aucun nouveau chat n’a été créé.

Le modèle conserve des acquiescements superflus et peut commencer à répondre avant la fin de toutes les précisions. Ce scénario n’établit donc pas une conversation parfaite. L’absence de répétition observée sur cette séquence ne dispense pas d’un essai humain prolongé.

- **Délégation Codex réelle, appel de 24 secondes** : une demande de calcul transmise au même chat technique existant, une délégation fournisseur, une soumission native, un résultat confirmé « 1053 » effectivement présent dans la sortie vocale. Aucun envoi de secours, aucune copie de chat. Réception native environ 1,3 seconde après la fin du stimulus ; résultat lu par le relais environ 7,6 secondes après cette fin. Ces durées concernent un calcul court, pas une tâche générale de développement.
- **Reprise ChatGPT réelle, appel de 16 secondes** : le bot rappelle correctement la dernière question du chat sélectionné depuis l’archive, sans délégation ni nouveau message dans le chat. Lecture initiale environ 1,3 seconde ; session prête environ 1,2 seconde après sa demande d’ouverture.

## Montre et installation

La montre Wear OS associée a reçu **0.11.0, code Android 22** avec comparaison de l’empreinte de l’APK transféré et installation sans effacement des données. Le relais installé utilise aussi les sources finales 0.11.0 ; la clé et l’association existantes sont conservées.

Les écrans réels de préparation ont été contrôlés par ADB et captures : ChatGPT sélectionné par défaut depuis l’entrée Live, projet « Sans projet », bouton Démarrer manuel ; ouverture avec un chat existant conservant Codex et le titre sélectionné. Aucun appel ni microphone n’a été démarré par cette vérification d’interface. L’écoute humaine du haut-parleur, l’écho et le passage Wi-Fi/LTE pendant un appel ne sont pas validés par ces captures.

## Distribution et limites

Les paquets restent des candidats locaux. Aucun dépôt GitHub ni publication Play Store n’est créé par cette validation. La résolution d’un nouveau chat natif en attente, l’accès global aux journaux vocaux sans chat, les confirmations de lecture, la reprise réseau et les validations du bureau restent décrits dans l’audit.
