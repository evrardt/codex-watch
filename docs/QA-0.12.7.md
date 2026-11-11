# Suivi de la voix Live Bluetooth

Le relais peut utiliser Opus à 24 kbit/s pour les montres compatibles ; la voix reste celle de l’agent et la compression est perceptuelle. Les anciens appareils restent compatibles avec le PCM ou la compression sans perte. Les paquets de 20 ms sont regroupés, et un changement de flux ou une interruption remet le décodeur à zéro.

Le décodeur intégré a été testé sur une Watch 7 : huit paquets Opus synthétiques ont produit 7 680 octets de PCM à 24 kHz après conversion depuis la sortie 48 kHz du système, avant et après remise à zéro. Ces tests ne remplacent pas un essai vocal humain.

Lors d’un essai Bluetooth de la version 0.12.6, le relais a compté 775 paquets Opus. Le volume mesuré des messages de sortie représentait environ 6,4 % du volume PCM encodé en Base64 de cet appel. La personne a toutefois signalé de petites saccades : cette mesure ne prouve pas que le débit soit la seule cause. L’essai ne confirme pas une interruption vocale, le compteur correspondant étant resté nul.

La version 0.12.7 augmente légèrement le tampon de lecture Android en Bluetooth et en mode automatique. Elle conserve le transport du microphone et le codec Opus. Lors d’un essai humain en Bluetooth, la personne a encore entendu quelques saccades. Le compteur d’interruptions était nul ; cet essai ne valide donc pas les interruptions vocales.

Un premier test synthétique local a trouvé un temps moyen de décodage supérieur à la durée des paquets sur la montre. Une nouvelle mesure a été très variable : le regroupement de plusieurs paquets de 20 ms n’a pas apporté de gain reproductible et n’a pas été activé. Ces mesures ne suffisent pas à attribuer toutes les saccades au décodeur.

Un autre essai sur la montre a comparé le décodeur Android au décodeur Java Concentus, sur le même signal synthétique, avec trois passages successifs Java/Android/Java. Les moyennes observées étaient respectivement de 36,1 / 16,8 / 14,5 ms par paquet de 20 ms, avec 52 / 17 / 16 appels dépassant 20 ms. Le résultat ne démontre pas d’amélioration fiable ; Concentus n’a pas été ajouté au produit. Des mesures complémentaires pendant un véritable appel sont nécessaires, les compteurs globaux pouvant inclure les silences.
