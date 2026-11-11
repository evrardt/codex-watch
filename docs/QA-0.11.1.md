# Réouverture du relais Windows

La version 0.11.1 recrée la fenêtre après sa fermeture et ne crée pas de fenêtre masquée au démarrage en arrière-plan. Le processus du relais et l’icône de notification restent actifs. Une fenêtre réduite est restaurée à l’ouverture.

La capture utilisateur montrait une fenêtre blanche ; le journal ne signalait aucun plantage du processus d’affichage et le relais répondait. L’origine exacte de la fenêtre blanche n’est pas établie. Cette correction évite de réutiliser une fenêtre fermée ou masquée potentiellement défaillante.

Le paquet Windows a été testé en profil isolé : trois cycles de fermeture et recréation ont chacun produit un écran avec les contrôles, pendant que le même processus de relais restait sain. La récupération après plantage volontaire du rendu, le redémarrage du moteur et l’association ont également été vérifiés. Les 114 tests du relais passent.

Le contrôle automatisé direct de la zone de notification Windows n’a pas pu être effectué : l’outil Computer Use ne parvenait pas à initialiser son environnement. Les cycles ont été déclenchés par le banc d’essai Electron, qui exerce la création de fenêtre et le même relais, sans simuler un clic réel sur l’icône.
