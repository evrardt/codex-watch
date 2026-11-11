# Security

Do not post tokens, API keys, conversation exports or relay state in public issues.
Until a private reporting channel is configured for the published repository, report only the affected version and ask a maintainer for a private channel.

The relay listens on localhost. Remote access requires a trusted HTTPS reverse proxy, such as Tailscale Funnel. Watch routes and the Live socket require a random bearer token, except the pairing endpoint, which accepts a one-time six-digit code during a two-minute window with five guesses maximum. Browser-origin requests to watch routes are rejected. The optional VPS browser administration is a separate surface: it requires its own administrator password, checks the configured HTTPS origin on changes, and uses a short-lived private link for initial setup. Discovery broadcasts the HTTPS origin only.

Only explicitly configured project roots are eligible for Codex operations. Desktop chats stay owned by the PC; the relay forwards messages through the bundled app-tools connector and never forks around writer locks. Native integration interfaces can change between Codex releases.

Windows GUI API keys use Electron safeStorage (Windows user protection). The watch encrypts relay credentials in its own storage. On the VPS, the API key is stored in a file readable by the relay account; an authenticated administrator can reveal it in the browser. Relay state contains private conversation excerpts, receipts and notification registrations. Protect the OS account and backups. Existing advanced CLI installations may use a private environment file instead of the GUI credential vault.

Before distributing builds, review the source export, verify checksums and use your own signing identities. Build outputs and `.local` must never be committed. New pairings receive individual credentials stored as hashes; an administrator can revoke each one, which closes active streams and removes its registered notification endpoints. Previously paired watches may still use the legacy shared token. Re-pairing does not invalidate that old token: invalidating it requires stopping the relay, replacing its pairing-token file, and reconnecting devices still using it. The administrator must also review and remove any legacy notification registrations.

The optional Windows Bluetooth Classic service requires authenticated, encrypted RFCOMM. It forwards only to the local relay; bearer authentication remains mandatory. Bluetooth device discovery requires user permission on the watch. The local proxy binds only to loopback on the watch.
