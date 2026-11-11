# Vérifications 0.12.9

- Accueil : libellé « Chat » et raccourci Live rouge.
- Le relais annonce `pluginSelection` dans ses options Live ; la montre propose le choix des plugins Codex avant l’appel. Un ancien relais sans cette capacité invite à le mettre à jour.
- Le relais contrôle les identifiants et vérifie leur disponibilité avant la réservation audio. Les demandes à Codex contiennent une demande d’utilisation des plugins sélectionnés. Cette instruction ne démontre pas à elle seule que le plugin a été exécuté : Codex doit confirmer sa disponibilité et son résultat. Les réponses vont dans le chat choisi, sans copie.
- Les tests automatisés couvrent le premier message d’un nouveau chat, la suite dans ce même chat, la séparation du contexte ChatGPT et le refus d’une sélection invalide avant réservation audio.
- Les applications et plugins propres à ChatGPT ne sont pas encore sélectionnables sur la montre. L’interface de transfert vers ChatGPT accepte actuellement un texte, sans paramètre documenté pour joindre la sélection structurée du menu « @ » ou « + ». Une liste locale ou une mention textuelle ne prouve pas que ChatGPT a bien attaché le plugin.
