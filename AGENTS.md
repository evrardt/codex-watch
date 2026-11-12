# Guidance for AI agents helping install Codex Watch

Help the user choose and complete the appropriate installation path. Explain the steps in their language and adapt to their experience. The watch and relay interfaces follow the device language in French, English, German, Spanish and Portuguese, and fall back to English for other languages. The detailed installation guides remain in French; use the actual translated screen labels rather than translating private conversations. Use the current release and the guides in this repository; do not invent application screens or claim to have tested hardware you cannot access.

## Choose a relay

- **Windows PC:** follow the illustrated [README](README.md#installation). The relay runs on the user's PC; the PC must remain on for the watch to reach it. A paired watch may connect over Bluetooth nearby or via a reachable HTTPS address on Wi-Fi/cellular.
- **Linux VPS:** follow [the VPS guide](docs/INSTALLER-VPS.md). The watch connects directly to the VPS; neither the Windows relay nor a PC is required after setup. Node.js 22+, npm and a working systemd user session are required. `node bridge/vps-setup.mjs install` is the documented installer; it refuses to overwrite an existing installation. The guide covers HTTPS, first-run setup and pairing.
- Both relays may be configured independently. Do not assume that their conversation history or capabilities are identical. See the README for the VPS Chat's API costs and separate history.

## Install and pair the watch

1. Download the release APK and `SHA256SUMS.txt` from the repository's releases, verify the APK checksum, and follow the README's phone-based Wear Installer 2 instructions. The same APK is used with both relay types. If the user prefers a computer and ADB is available, follow the linked Android documentation. ADB pairing requires actions on the watch; ask for the current connection address only when needed.
2. Preserve existing data. An APK signed with a different key cannot be installed as an update: do not uninstall the existing app or reset the watch as a workaround. Explain the consequence and stop until an appropriate migration is available.
3. Pair the watch using the code displayed by the selected relay. The Android debugging pairing code and the Codex Watch relay code are separate. VPS pairing uses the HTTPS origin, without `/admin` or a path. A PC or VPS can be used alone.
4. Verify the chosen relay reports a confirmed pairing and that the watch can open a conversation. Offer a notification test if configured. Distinguish direct alerts from optional Firebase push. Test the actual selected transport; report anything that could not be checked.

## Accounts, credentials and network access

- Never ask the user to paste passwords, API keys, Firebase private keys, pairing tokens, private setup links or conversation contents into chat, issues or logs. Have them enter secrets directly in the appropriate local or HTTPS interface. Never commit local configuration or credentials.
- Codex authentication is performed by the user through the official device login when requested by the relay. The VPS Chat and Live require an OpenAI API key and may incur API charges; a ChatGPT subscription alone does not guarantee an API balance. They are optional when the user only wants Codex.
- Installing Tailscale Funnel or another public endpoint exposes the relay to the Internet. Explain that exposure and obtain any authorization required by the user's environment before enabling it. Do not modify unrelated existing services, accounts, firewall rules or security policies.
- Firebase is optional. Follow [the notifications guide](docs/NOTIFICATIONS.md) and import files only into the relay the user selected. The private service-account key is sensitive and remains on the relay. Use the Android package ID shown in that guide; it identifies the existing app and must not be changed casually.
- For server setup, let the user choose the administrator password through the first-run browser interface using the private setup link. Do not post that link publicly or in chat. Do not replace an existing configuration or rotate credentials unless the user has requested it.

If the user asks for development rather than installation, also read [CONTRIBUTING.md](CONTRIBUTING.md). When application screens, setup steps or release filenames change, update the README and relevant guide images, regenerate the offline guides with `python scripts/render-guide-html.py`, and check them with `python scripts/render-guide-html.py --check`.
