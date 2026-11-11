# Passerelle vocale et fenêtre du relais — 0.10.0

Vérifications du 8 novembre 2026. Cette version remplace les blocages de lecture introduits en 0.9.2 par une conversation continue : un flux audio permanent dans chaque sens, et des travaux natifs asynchrones dans le chat sélectionné.

## Comportement

Le modèle vocal peut répondre, clarifier et prendre brièvement la parole pendant que le microphone reste actif. Les tâches qui nécessitent le PC ou les connaissances absentes du contexte sont déléguées à Codex ou ChatGPT. Un modèle vocal ne peut pas garantir à lui seul la véracité d’une affirmation : les actions exécutées et leurs résultats restent confirmés par le moteur natif, jamais par une promesse orale.

La montre ne vide plus son lecteur à chaque fragment de transcription. Une nouvelle prise de parole soutenue pendant une réponse déclenche une interruption ; si la personne parlait déjà, le bot peut prendre la parole. Le bouton d’interruption et les commandes explicites restent disponibles. Les tampons de lecture sont vidés, les anciens paquets sont ignorés et le microphone continue. Une interruption de parole n’annule pas le travail du PC.

Le déclenchement de secours après stabilisation n’envoie plus chaque intervention au moteur : il laisse d’abord répondre ou déléguer l’agent vocal. Le contexte d’une clarification orale accompagne une demande transmise au même chat. Les retours sont associés à leur demande ; un changement de contexte ne doit pas transformer la destination d’un envoi déjà en cours.

## Essais

- **102 tests Node réussis** : flux simultanés, dialogue pendant une tâche, interruption sans annulation, rejet de l’ancienne fin audio, contexte oral dans la délégation, destination conservée et réponse remplacée pendant une lecture asynchrone.
- **24 tests JVM réussis**, APK debug compilé, lint sans erreur (9 avertissements). Le détecteur distingue une nouvelle prise de parole d’une voix utilisateur déjà en cours et ignore silence/bruit bref.
- Exécutable Windows empaqueté : plantage volontaire du processus d’affichage, retour de l’interface, même processus moteur et santé Codex conservés. Un arrêt volontaire du moteur a aussi confirmé sa reprise automatique. Association unique et chiffrement testés dans un profil isolé.
- Essai réel HTTPS de 80 secondes avec voix synthétiques et chevauchement : explication orale, interruption pendant la réponse, nouvelle consigne demandant « bleu », question posée par le bot pendant la voix utilisateur, puis délégation explicite au même chat Codex et résultat « 1053 » effectivement prononcé. Une seule tâche native a été transmise durant cette conversation à plusieurs échanges.
- Relais et montre Wear OS mis à jour en 0.10.0 (code Android 21), configuration conservée.

## Fenêtre blanche

La capture utilisateur montrait une fenêtre sans contenu. Sa cause graphique exacte n’a pas été établie. Le relais utilise désormais le rendu logiciel, attend son premier rendu avant d’afficher la fenêtre et recharge son interface après un plantage ou un blocage du processus d’affichage. Les erreurs d’affichage sont consignées séparément. Le test de récupération ci-dessus valide cette protection ; il ne prouve pas l’origine de chaque écran blanc passé.

## Limites de validation

L’essai vocal automatisé utilise le vrai service Live, mais ne remplace pas l’écoute d’une personne sur le haut-parleur de la montre. L’écho, le volume de la voix réelle et les bruits ambiants peuvent influer sur la détection locale ; la validation humaine a été demandée. Les temps d’analyse natifs ChatGPT restent variables. Les paquets sont des candidats locaux : aucun nouveau dépôt public ou publication Play Store effectué.

Références : [conversation et interruptions Live](https://developers.openai.com/api/docs/guides/live-prompting), [contrôles de lecture](https://developers.openai.com/api/docs/guides/voice-server-controls?api=live&voice-api=live).
