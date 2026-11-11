# Contributing

Use Java 17, Android SDK 35, Node.js 22 or newer, and Gradle 8.9. Build with `./gradlew :wear:assembleDebug :wear:testDebugUnitTest :wear:lintDebug`. In `bridge`, use `npm ci` and `npm test`. In `desktop`, use `npm ci`, `node node_modules/electron/install.js` if your package manager skips Electron's runtime setup, then `npm start` or `npm run dist` on Windows.

Keep credentials and machine paths out of patches and screenshots. Use test doubles for model calls. Do not add paid smoke tests to CI. Preserve same-chat forwarding, uncertain-delivery protection, project authorization and audio quota reservations.

The current interface is French. Verify round screens, rotary navigation, large font settings, manual Live startup, stopping capture on exit, and offline recovery before proposing UI changes. New provider capabilities must come from actual host schemas or official documentation, never simulated controls.

After editing the README, regenerate the offline guide with `python scripts/render-guide-html.py` (requires `markdown-it-py==4.0.0`). Keep `GUIDE-INSTALLATION.html` and `docs/guide` together when distributing the source. The desktop screenshots can be regenerated with Electron using `scripts/guide-screenshots.cjs`; its preload supplies fictional data and never contacts a real relay. See [the release preparation instructions](docs/PUBLICATION.md) when distributing builds.

When a change affects the user journey, installation, release filenames, UI labels or setup screens, update the README and relevant guide images in the same change. Check the instructions against the actual application and current official links; regenerate screenshots with fictional data when screens change. Then regenerate `GUIDE-INSTALLATION.html` and run `python scripts/render-guide-html.py --check`. The pull request checklist records this review; automated checks cannot establish that screenshots or instructions still match the product.
