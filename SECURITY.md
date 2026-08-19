# Security Policy

## Supported version

Security fixes are provided for the latest published release.

## Reporting a vulnerability

Use GitHub's **Report a vulnerability** option under the repository's Security tab when available. Please do not post credentials, private Hermes logs, prompts, responses, session identifiers, or proof-of-concept secrets in a public issue.

For ordinary bugs that contain no private information, open a GitHub issue with:

- Overlay version
- Windows version
- Hermes Desktop version
- Reproduction steps
- Sanitized error text

## Security model

- The event server binds only to `127.0.0.1`.
- Every event requires a random per-install pairing token.
- Request bodies are size-limited.
- Incoming protocol, status, and activity-node fields are allowlisted; unknown fields are discarded.
- Raw session IDs, raw tool names, prompts, file data, and tool data are discarded.
- The Electron renderer uses context isolation, sandboxing, disabled Node integration, denied navigation/popups/permissions, and a restrictive Content Security Policy.
- The application has no telemetry or cloud backend.

A process already running as the same Windows user can generally read or alter that user's files. The local token protects primarily against drive-by browser requests and accidental event spoofing; it is not intended to defend a compromised operating-system account.

## Release checks

Public releases must pass:

```powershell
npm ci
npm test
npm run check
npm run audit:release
npm audit
npm run pack:win
```

Release artifacts are scanned for personal paths and credential-like strings, and SHA-256 checksums are published with each release.
