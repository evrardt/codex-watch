# Live, agents et plugins : recherche technique

## Approches documentées

- [GPT-Live et délégation](https://developers.openai.com/api/docs/guides/live) sépare la conversation vocale de l’agent qui exécute les procédures et les outils. La délégation « client » permet de conserver un agent existant et de lui transmettre le contexte ; l’application reste responsable des permissions et du suivi. C’est l’approche du relais pour le chat Codex existant.
- [LiveKit pour GPT-Live](https://docs.livekit.io/agents/models/realtime/gpt-live/) illustre cette séparation : en mode client, les outils ne sont pas attachés directement à la voix ; le programme traite la délégation et retourne le résultat. Le contexte et les corrections de l’utilisateur doivent être conservés par le client.
- [Outils et MCP avec Realtime](https://developers.openai.com/api/docs/guides/realtime-mcp) décrit une autre architecture, où une session Realtime peut appeler des fonctions ou des serveurs MCP. Elle n’implique pas que les plugins ou les comptes connectés à ChatGPT soient automatiquement disponibles, et ne garantit pas la continuité du même chat Codex ni la même expérience vocale.
- [Délégation et outils GPT-Live](https://developers.openai.com/api/docs/guides/live-delegation) distingue les informations silencieuses des éléments à dire ; chaque événement est limité à 500 tokens. Les fragments de transcription ne constituent pas à eux seuls un tour complet. Un accusé d’insertion d’instruction ne confirme ni une action externe ni que la voix a terminé.
- [Évaluation d’agents vocaux duplex](https://github.com/openai/openai-cookbook/tree/main/examples/audio/duplex_voice_agent_evaluation) propose des essais synthétiques, enregistrés et multi-tours. Ils doivent couvrir les interruptions, les outils et les résultats en plus du simple démarrage audio.

## Conséquences pour Codex Watch

Le plugin doit être choisi et exécuté par un agent qui dispose réellement de ses consignes et de ses outils. Le modèle vocal ne reçoit que des consignes de conversation et les résultats publics ; il peut les reformuler. Le relais suit la demande dans le chat choisi, sans créer de copie, et ne doit pas relancer une action dont la réception est incertaine. Il peut empêcher l’envoi au haut-parleur d’une réponse prématurée, tout en continuant à recevoir le micro, mais cela ajoute une attente avant la première réponse.

L’[app-server Codex](https://learn.chatgpt.com/docs/app-server) documente la liste des applications accessibles et une mention structurée `app://` pour ses propres tours. Le relais actuel s’appuie toutefois sur l’interface du bureau partagé pour ne pas prendre un second verrou d’écriture ; ses méthodes d’envoi n’exposent ici qu’un texte. Une mention textuelle dans ce canal ne prouve pas qu’une sélection structurée a été attachée. La sélection fiable des plugins et applications du compte ChatGPT nécessite donc une interface prise en charge pour ces objets et ce chat ; il ne faut pas la confondre avec l’inventaire local Codex.

Les essais simulés ne remplacent pas un appel réel : il faut notamment observer le premier tour, la recherche effective du plugin, les sources, une interruption et une réponse à une éventuelle question, sur les transports pris en charge.

## Suivi d’une tâche pendant la conversation

L’[exemple du projet GPT-Live sur Raspberry Pi](https://developers.openai.com/blog/bringing-my-led-display-to-life) conserve la conversation et le travail de recherche en parallèle. La [documentation de délégation](https://developers.openai.com/api/docs/guides/live-delegation) distingue expressément une interruption vocale d’une modification de demande et recommande un identifiant et une révision propres à chaque opération. Un [incident documenté par LiveKit](https://github.com/livekit/agents/issues/7679) illustre une autre perte de résultat : le travail d’un outil se terminait après l’interruption de son tour vocal, sans que sa sortie soit transmise. Ces exemples confirment la nécessité de suivre séparément la lecture audio, le travail et la remise du résultat ; ils ne prouvent pas que notre relais a la même cause interne que LiveKit.
