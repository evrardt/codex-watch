# Préparer la signature Windows

Les préversions actuelles du relais Windows ne sont pas signées par un éditeur reconnu. La signature de l’APK Wear OS est indépendante et ne signe pas l’installateur Windows.

[SignPath Foundation](https://signpath.org/) propose une signature gratuite à certains projets open source, après examen ; son acceptation et le certificat ne sont pas automatiques. Ses [conditions](https://signpath.org/terms.html) incluent notamment l’authentification multifacteur, une politique de signature, une construction vérifiable et une approbation de chaque publication. Un certificat commercial reconnu peut aussi être utilisé.

## Si le projet est accepté par SignPath

1. Le propriétaire présente le projet via [la candidature SignPath](https://signpath.org/apply) et termine la création de son compte et ses vérifications. Ne pas annoncer que SignPath fournit la signature avant son acceptation.
2. Dans SignPath, configurer le dépôt GitHub comme système de construction de confiance, l’artefact contenant l’installateur et une politique de signature de publication avec approbation. Définir ensuite la politique de signature et les rôles exigés sur le dépôt et les pages de release.
3. Dans les paramètres GitHub du dépôt, créer le secret Actions `SIGNPATH_API_TOKEN` et les variables `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG` et `SIGNPATH_POLICY_SLUG` avec les valeurs fournies par SignPath. Ne jamais placer le jeton dans le dépôt.
4. Depuis **Actions → Sign Windows installer**, lancer manuellement le workflow sur la branche de release avec le numéro de version du relais. Il reconstruit le programme, transmet l’artefact à SignPath et attend l’approbation requise. Il vérifie ensuite la signature Authenticode et conserve l’installateur signé dans les artefacts GitHub ; il ne publie pas automatiquement de release.
5. Avant publication, vérifier l’identité du certificat, l’installateur signé et ses empreintes, puis créer une release dont les notes et `SHA256SUMS.txt` correspondent aux fichiers effectivement publiés.

Le workflow ne remplace ni l’examen de SignPath ni les validations de son propriétaire. Référence : [intégration GitHub officielle de SignPath](https://docs.signpath.io/trusted-build-systems/github).
