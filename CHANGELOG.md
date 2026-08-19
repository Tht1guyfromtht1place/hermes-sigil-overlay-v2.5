# Changelog

## 2.5.0 — Public release

- Published the V2.5 Hermes Sigil visual overlay for Windows.
- Added automatic installation and repair of the Hermes Desktop activity bridge.
- Added support for the default Hermes profile and detected named profiles.
- Added a cryptographically random per-install local pairing token.
- Removed the unauthenticated legacy WebSocket event server.
- Removed raw session IDs, raw/custom tool names, arbitrary event names, timestamps, progress, and attention metadata from bridge payloads.
- Added strict protocol, status, activity-node, authentication, and payload-size validation.
- Added Electron sandboxing, navigation/popup/permission denial, and a Content Security Policy.
- Added a guided Windows installer, application icon, privacy policy, security policy, and uninstall instructions.
- Added automated tests, dependency audit, release sanitization, GitHub Actions verification, and clean-machine installer testing.
