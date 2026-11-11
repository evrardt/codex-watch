# Changelog

## 0.12.51 — APK allégé

- L’APK de release utilise la réduction du code et des ressources pour diminuer son téléchargement. Le relais Windows 0.12.50 reste compatible.
- La construction de l’APK de release est vérifiée dans la CI. Le démarrage, l’association HTTPS de démonstration, l’ouverture d’une conversation, une notification directe et le décodeur audio ont été essayés sur émulateur ; les essais sur montre et les connexions cellulaires restent nécessaires.

## 0.12.50 — Première préversion publique

- Les demandes Codex prises en charge apparaissent dans leur conversation, avec choix lisibles et réponse libre. Sur Windows, certains formulaires du chat ouvert peuvent être traités depuis la montre ; les cas non reconnus restent à traiter sur le PC.
- L’envoi affiche son état et le relais vérifie la confirmation sans renvoyer automatiquement une réponse incertaine. Le retour à la conversation limite les déplacements de l’écran.
- Le relais PC et le relais VPS se configurent séparément ; si les deux sont associés, la montre permet de passer de l’un à l’autre. Les fonctionnalités et l’historique disponibles dépendent du relais choisi.
- L’installation et les limites de la version sont expliquées dans le guide, notamment pour la 4G, les notifications et les modèles Phonon.

## 0.12.35 — Installation et demandes

- Le relais VPS démarre lors d’une nouvelle installation Linux, puis vérifie sa disponibilité avant de confirmer l’installation.
- Les associations récentes ont chacune un accès révocable ; les anciennes associations partagées restent actives jusqu’à rotation du jeton.
- Le relais PC peut signaler les états d’attente exposés par Codex. Les formulaires natifs du bureau restent à traiter sur le PC.
- Les cartes Wear OS et les libellés s’adaptent mieux aux petits cadrans ; le guide et le suivi indicatif des dépenses du Chat VPS sont actualisés.

## 0.12.26 — Chat indépendant sur le serveur

- L’accueil de la montre permet de basculer rapidement entre le PC et le VPS, avec des conversations distinctes.
- Le relais autonome peut proposer un chat local utilisant un abonnement ChatGPT éligible, après une autorisation explicite et un transfert sécurisé de la session vers le serveur. Les conversations du site restent séparées.

## 0.12.25 — Connexion à un VPS existant

- Le relais Windows permet d’enregistrer une connexion SSH, de vérifier un relais VPS compatible, de consulter ses projets et d’associer une montre avec son adresse HTTPS.
- Le relais PC et le relais VPS restent indépendants. Le serveur doit déjà être installé et son HTTPS configuré ; la page ne modifie pas les projets du VPS.

## 0.12.24 — Choix du modèle et de la réflexion

- Les commandes **Modèle** et **Réflexion** sont regroupées en bas des conversations Codex et utilisent la même présentation.
- Le choix de la réflexion peut être ouvert directement ; si nécessaire, l’application propose d’abord de choisir un modèle.

## 0.12.23 — Modèle dans la conversation

- Un chat Codex permet de choisir son modèle et sa réflexion en haut ou en bas de la conversation, sans modifier les autres chats.
- Le réglage du chat est aussi transmis lors d’un Live ouvert sur cette conversation ; ChatGPT conserve les réglages du PC.

## 0.12.22 — Recherche qui ne bloque plus

- Si la liste récente tarde à répondre, le relais essaie rapidement la liste complète et limite la durée de recherche, sans répéter une demande ni ouvrir un chat non confirmé.

## 0.12.21 — Ouverture plus réactive

- Pendant une création, le relais vérifie plus régulièrement si le chat existe, tout en regroupant les demandes répétées et en respectant les limites du service.

## 0.12.20 — Ouverture des chats récents

- Lorsqu’une création est en attente, le relais utilise aussi la liste récente du PC si elle couvre toute la période à vérifier ; le message initial et le projet restent vérifiés avant l’ouverture.
- Une limite sur la liste complète n’empêche plus automatiquement la lecture d’un chat identifié. Les limites de lecture sont toujours respectées.

## 0.12.19 — Suivi des créations pendant la veille

- Le relais continue à rechercher les conversations en cours de création pendant que la montre est en veille, sans renvoyer la demande.
- Le chat ne s’ouvre qu’après vérification de son identité ; les délais imposés par ChatGPT restent respectés.

## 0.12.18 — Création à confirmer

- Une création en attente ne prétend plus que le message a été transmis à ChatGPT ou qu’une réponse est en cours avant confirmation du chat.
- En cas de délai prolongé ou de limite de lecture, la montre invite à vérifier la conversation avant de renvoyer.
- Les vérifications ChatGPT en arrière-plan sont espacées quand les chats suivis sont inactifs, et une lecture concurrente ne supprime plus un délai de limitation actif. Les notifications ChatGPT peuvent prendre jusqu’à deux minutes en veille.

## 0.12.17 — Nouveau chat et synchronisation

- Les nouvelles conversations affichent immédiatement le message transmis et l’attente de réponse.
- Les limites temporaires de lecture ChatGPT sont indiquées clairement et le relais conserve les listes déjà chargées.

## 0.12.16 — Ouverture des nouvelles conversations

- Après une création native en cours, la montre affiche le suivi puis ouvre le chat retrouvé sans renvoyer la demande.
- Le relais vérifie le projet, le texte initial et la date ; en cas d’ambiguïté ou d’historique indisponible, il n’ouvre pas un chat au hasard.

## 0.12.15 — Fluidité

- Réduction des données échangées et des reconstructions d’interface pour les chats inchangés.
- Formatage plus léger des longues réponses et suppression de lectures en double côté relais.
- L’interface PC suspend ses rafraîchissements lorsqu’elle est masquée ; correction du réglage de lecture automatique depuis le PC.

## 0.12.14 — Alertes des réponses dictées

- Les alertes de réponse dictée restent visibles et ne sont silencieuses que si la lecture a réellement démarré dans l’application ouverte.
- Si la lecture ne démarre pas, si l’application est quittée ou si elle est arrêtée pendant l’attente, une alerte sonore est conservée.

## 0.12.13 — Dictée et Live

- Conversation : réponses au clavier ou par dictées successives modifiables, et accès Live distinct.
- Lecture automatique après une demande dictée, réglable sur le PC et la montre.
- En Live avec un plugin Codex, le relais peut transmettre une première demande après attente si la délégation vocale ne démarre pas ; les délégations tardives sont dédupliquées.

## 0.12.12 — Live et tâches en arrière-plan

- Les échanges vocaux et les demandes d’avancement ne masquent plus automatiquement le résultat d’une tâche en cours.
- Le relais attend la résolution d’une nouvelle délégation avant de restituer un résultat susceptible d’être remplacé.

## 0.12.11 — Réponses Live et plugins

- En contexte Codex avec un plugin sélectionné, la sortie vocale attend la délégation pour éviter une réponse improvisée prématurée ; le micro et les interruptions restent actifs.
- Si la délégation n’aboutit pas, le Live indique que la demande n’a pas été transmise et propose de réessayer.

## 0.12.10 — Live avec plugins Codex

- Lorsqu’un plugin Codex est sélectionné, le Live demande la délégation des interventions de fond et attend le résultat confirmé avant de conclure à sa disponibilité ou son utilisation.
- La liste distingue les plugins avec consignes des applications ; les réponses de plugin sont transmises au Live en fragments pour conserver leur contenu et respecter les limites de l’API.
- La sélection reste une demande textuelle à Codex ; la mention structurée « @ » et la sélection des applications ChatGPT ne sont pas encore prises en charge.

## 0.12.9 — Accueil et applications Live

- Accueil : « Chat » remplace « ChatGPT » et le raccourci Live devient rouge.
- Avant le Live, sélection facultative de plugins Codex ; le relais vérifie la sélection avant l’appel et l’ajoute aux demandes Codex.
- Le relais indique que la sélection des applications propres au compte ChatGPT n’est pas encore disponible.

## 0.12.8 — Décodage Live plus rapide

- Décodeur Opus natif sur la montre, avec repli vers Android ; la voix et le micro restent inchangés.
- Réinitialisation du décodeur lors d’une interruption ou d’un nouveau flux audio.

## 0.12.7 — Lecture Live plus régulière

- Tampon de lecture légèrement agrandi sur la montre en mode Bluetooth et automatique pour mieux absorber les variations de débit.

## 0.12.6 — Voix Live compacte

- Encodage Opus en Bluetooth sur les montres compatibles, avec retour à la compression sans perte si nécessaire ; le microphone conserve son transport existant.

## 0.12.5 — Voix Live en Bluetooth

- Compression sans perte de la voix du Live entre le relais et les montres compatibles en Bluetooth ; retour automatique au format précédent si la compression ne réduit pas la taille ou si la montre ne la prend pas en charge.

## 0.12.4 — Retour au transport Live précédent

- Retrait de la modification audio 0.12.3 après un appel où le microphone n’a pas été transcrit. Les saccades Bluetooth restent à étudier.
- Ajout d’un compteur local de signaux d’activité du micro pour distinguer un microphone silencieux d’un problème de liaison, sans enregistrer le flux audio.

## 0.12.3 — Audio Live Bluetooth

- Réduction de la fragmentation des trames Bluetooth et ajout d’une petite réserve audio pour mieux absorber les variations de débit pendant le Live.

## 0.12.2 — Connexions automatiques

- Choix Automatique, Bluetooth ou Internet sur la montre et affichage des états de connexion sur les deux appareils.
- Bascule entre les liaisons pour les demandes pouvant être répétées sans risque de doublon ; reprise d’une session Live après une courte coupure.

## 0.12.1 — Connexion Bluetooth

- Conservation de l’identité Codex Watch et des réglages existants.
- Liaison directe Bluetooth chiffrée entre la montre et le relais Windows.
- Les événements du PC permettent d’ouvrir le chat sur la montre.

## 0.11.11 — adjustable reading-speed slider

- Replace speed choices with a slider on the watch and relay, from 0.75× to 1.50× in 0.05× steps.

## 0.11.10 — voice controls and warm startup

- Per-provider reading speed on the watch and in the desktop relay.
- Optional Phonon preload at relay startup with retained model.
- Read link labels aloud without their destinations.

## 0.11.9 — smoother long-form reading

- Prepare the next speech segment during playback and link prepared audio players for smoother transitions.
- Prefer sentence boundaries and keep a one-segment prefetch limit, including watch-voice fallback.

## 0.11.8 — clearer shared voice settings

- Make watch, OpenAI and Phonon output selectable on both PC and watch, with the selected provider clearly marked.
- Show provider-specific settings only for the selected output and keep the shared Live/OpenAI budget separate.
- Synchronize the selected output and voice between the relay and watch.

## 0.11.7 — multilingual Phonon voices

- Add Phonon multilingual, default to Noémie and allow voice selection from the watch or PC.
- Download a selected voice once, verify its checksum and synthesize locally.
- Detect the main language of long, unambiguous passages; retain the voice language when uncertain. Live is unchanged.

## 0.11.6 — local Phonon reader

- Add Gradium Phonon as an optional local French voice for reading messages, with watch voice fallback.
- Install the pinned runtime and model from the Windows relay after accepting the model terms; verify downloaded files.
- Keep Live on its existing OpenAI audio path.

## 0.11.5 — pairing confirmation and key visibility

- Confirm pairing on the PC only after the watch verifies and saves its connection; distinguish accepted codes from completed pairing and expiry.
- Submit pairing from the watch keyboard and avoid pre-filling a masked token into the code field.
- Show whether an API key is stored and loaded; reveal it only on request, then clear it automatically after 30 seconds, on focus loss or when leaving the page.
- Reject an empty replacement key and safely restart the relay when a key is changed.

## 0.11.4 — hide unavailable projects

- Exclude missing project folders from the desktop picker and selection counts while retaining their existing configuration.
- Recheck visible folders as the settings page refreshes and keep the relay running if previously authorized folders disappear.

## 0.11.3 — unavailable project folders

- Identify unavailable project folders in the desktop project picker and select only accessible folders with Select all.
- Keep the relay running when previously authorized project folders are missing, without granting access to those projects.
- Explain a folder disappearing during save and preserve the previous configuration on failure.

## 0.11.2 — clearer startup and tray controls

- Open the interface with one click on the tray icon and explain that quitting stops the watch connection.
- Restart an intentionally stopped relay when the user launches the application again; start the service independently of tray creation.
- Keep Codex and ChatGPT available if the audio-key vault cannot be opened, preserving the encrypted key and displaying an actionable warning.
- Show the service state and only the relevant start/stop actions; add a visible-window fallback and safe startup diagnostics.
- Exercise full startup, quit, relaunch and an unavailable audio vault with isolated profiles.

## 0.11.1 — relay window reopening

- Recreate the desktop interface when reopened after closing it, keeping the tray and relay process active.
- Start in the background without creating a hidden renderer and restore minimized windows on demand.
- Exercise three close/reopen cycles with a live relay, including rendered UI and backend continuity checks.

## 0.11.0 — Live ownership and repeated interruptions

- Make semantic Live delegation the sole automatic native-task trigger; remove transcript/silence reply nudges and fallback submissions.
- Distinguish inherited history from the start of a new call, preventing historical answers from being presented as new results.
- Coalesce acoustic and transcript interruption controls; bound confirmation and transcript waits.
- Preserve the preceding oral dialogue, destination and instruction boundaries across asynchronous native reads and queued delegations.
- Keep late results as labelled silent context when the user has spoken or changed target since submission.
- Track bounded call diagnostics without recording raw audio or credentials; silent PCM no longer keeps idle calls open.
- Recover a living but unresponsive relay after three health failures, while tolerating transient failures and a disconnected Codex engine.
- Explain insufficient Live budget separately from a disconnected desktop and refresh readiness after hangup.
- Document the remaining gaps in new-chat resolution, voice-only history, playback receipts, network recovery and desktop approvals.

## 0.10.0 — continuous voice gateway

- Keep audio and microphone streaming concurrently while native work runs; allow ordinary conversation and useful overlapping speech.
- Replace blanket speech blocking with explicit user interruption, immediate playback flushing, audio revisions and rejection of stale queued sound.
- Detect a new sustained user onset on the watch without silencing a bot that takes the floor while the user was already speaking.
- Use structured Live conversation/delegation policies; recovery dispatch runs only if the voice agent has neither answered nor delegated.
- Include recent oral clarification in native handoffs and preserve source routing and request correlation during asynchronous work.
- Use audible PCM energy for speaking state rather than treating silent output packets as speech.
- Recover a crashed/unresponsive relay window independently of its background engine; use software rendering and wait for the initial paint before showing it.

## 0.9.4 — speech dispatch

- Dispatch completed transcript utterances even when the watch never emits its acoustic end-of-speech hint.
- Coalesce transcript fragments before sending, preserving same-chat routing and duplicate protection.
- Respond locally to microphone checks without creating or replacing a native task.
- Show transmission and waiting state immediately; explain known send failures aloud.

## 0.9.3 — relay readiness

- A rate-limited ChatGPT catalog no longer disconnects the healthy Codex transport.
- Live availability is independent of recent-chat listing; opening Live no longer fetches that optional catalog.
- ChatGPT listing and history share a cooldown. Repeated listings are coalesced and cached; project discovery has a short cache.
- Regression checks cover the original 429 → false PC-disconnection chain.

## 0.9.2 — relay update (watch 0.9.1 compatible)

- Seed Live with native conversation roles and preserve trailing questions in long answers.
- Resume the selected chat immediately, retain context on short follow-ups and keep transmission receipts silent.
- Reduce active ChatGPT history caching to 1.8 seconds, coalesce reads and retain global rate-limit backoff.
- Correlate spoken backend results with the submitted message; reject stale cached answers and sort merged native turns chronologically.
- Remove an extra 1.6-second fallback wait after speech detection; status lookups never create a task.
- Keep the call open while native work is pending, give one waiting update and bound retries after connection failures.

## 0.9.1

- Plugin picker in message composition, with up to five explicit selections and no automatic installation.
- Bounded plugin catalog requests, partial local fallback and honest cached/activation status.
- Host model catalog refresh on selection; unavailable saved models are explained.
- ChatGPT history request coalescing, idle polling reduction, throttling cooldown and clearly labelled local snapshots.
- Specific service errors are preserved instead of reporting every upstream failure as an offline PC.
- Live utterance fallback, exact-chat delivery status and locally retained voice exchanges accessible from that chat.
- Windows select-all projects, automatic apply/restart, persistent error feedback, pairing countdown and backend recovery.

## 0.9.0

- Manual Live preparation: ChatGPT default from home, explicit project choice, new chat on the first instruction. Opening Live inside a chat preserves that chat.
- Media audio route, speech gain with soft limiting, microphone and playback energy animation.
- Live, ChatGPT and Codex in one home row; persistent Live access beside conversation replies; shorter controls.
- Codex model and reasoning selection based on the connected host's real capabilities.
- Installed plugins, searchable catalog, explicit install/remove/activation actions.
- Questions and one-time approvals for the standalone engine; honest PC limitation and open-on-PC action.
- Graphical monthly audio allowance in USD, including conservative reservations.
- Windows relay GUI, tray, installer, system credential vault, project setup, HTTPS helper, temporary pairing code and Wi-Fi discovery.

The release is a distribution candidate. Store approval, public repository publication, Windows certificate signing and wider device testing are separate release steps.
# En préparation

- Chat indépendant sur le VPS via l’API OpenAI, avec configuration sur le VPS et historique séparé ; le profil PC reste inchangé.
- Interface web autonome du VPS, association directe de la montre et parcours séparés PC / VPS.
- Le sélecteur de relais apparaît uniquement lorsque les deux connexions sont configurées.

