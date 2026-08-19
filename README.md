# Hermes Sigil Overlay

A transparent, animated Windows activity overlay for **Hermes Desktop**. The sigil responds to live agent activity such as reasoning, searching, browsing, reading, tool use, file creation, device control, waiting, and completion.

> Community project. Not affiliated with or endorsed by Nous Research. Hermes is a project of Nous Research.

![Hermes Sigil Overlay](assets/hermes-sigil.png)

## Requirements

- Windows 10 or Windows 11 (64-bit)
- A current installation of [Hermes Desktop](https://hermes-agent.nousresearch.com/)

No Node.js, developer tools, API keys, or model credentials are needed when installing from the GitHub Release.

## Install

1. Install and open Hermes Desktop at least once.
2. Download **`Hermes-Sigil-Overlay-Setup-2.5.0.exe`** from this repository's [Releases](../../releases/latest) page.
3. Run the installer and launch **Hermes Sigil Overlay**.
4. The overlay automatically installs its small activity bridge into the default Hermes Desktop profile and any named profiles already present.
5. Hermes Desktop normally hot-loads the bridge within a few seconds. If its status bar still shows `sigil o`, open the Hermes command palette and run **Reload desktop plugins**.

The overlay's center connection light turns green when live Hermes events are arriving.

### Windows SmartScreen

This community build is not currently code-signed. Windows may display **Windows protected your PC**. Only continue if the installer came from this repository's official Releases page and its SHA-256 checksum matches the release notes. Select **More info → Run anyway**.

## Privacy

Hermes Sigil Overlay requires **none** of your:

- Model-provider API keys or OAuth tokens
- Hermes credentials or configuration
- Prompts, responses, or reasoning text
- File names or file contents
- Tool arguments or results
- Terminal commands or output
- URLs or webpage contents
- Environment variables
- Raw session identifiers

The desktop plugin classifies activity inside Hermes and sends only a fixed vocabulary of visual categories, coarse lifecycle status, a fixed error category when needed, and a session-active boolean to `127.0.0.1` on the same machine. It has no telemetry or cloud service. See [PRIVACY.md](PRIVACY.md) for the complete data boundary.

Each installation creates a random local pairing token. This token is unrelated to Hermes credentials and is used to prevent drive-by webpages and accidental local event spoofing. It is not a defense against software already running as your Windows user.

## Controls

| Control | Action |
|---|---|
| Left-drag | Move overlay |
| Mouse wheel | Resize overlay |
| Right-click | Enable click-through |
| `Ctrl+Alt+H` or `Ctrl+Shift+F` | Toggle click-through |
| `Ctrl+Shift+S` | Show or hide |
| `Ctrl+Shift+Up / Down` | Adjust opacity |
| `Ctrl+Shift+Right / Left` | Adjust animation speed |
| `Ctrl+Shift+C` | Toggle activity labels |
| `Ctrl+Shift+X` | Toggle adaptive contrast |
| `Ctrl+Shift+D` | Show bridge connection status |
| `Ctrl+Shift+T` | Run or cancel the full node test |
| `Ctrl+Shift+Q` | Quit |

The tray menu provides the same controls plus position reset and bridge install/repair.

## Troubleshooting

### Overlay says Hermes Offline

1. Confirm Hermes Desktop is running.
2. Right-click the overlay tray icon and select **Install / Repair Hermes Bridge**.
3. In Hermes Desktop Settings → Plugins, make sure **Hermes Sigil Bridge** is enabled if it appears there.
4. Run **Reload desktop plugins** from the command palette.
5. Check the Hermes status bar for `sigil *`.

### Overlay is off-screen

Right-click its tray icon and select **Reset Position and Size**.

### Port conflict

The local bridge uses `127.0.0.1:8765`. Only one process can own that port. Quit other Hermes Sigil copies first. To identify a different owner, run `netstat -ano | findstr :8765` and look up the reported PID in Task Manager.

## Uninstall

Uninstall **Hermes Sigil Overlay** from Windows Settings → Apps. The installer runs the app's bridge-removal mode before deleting the application. Portable/source users can remove the bridge manually from the tray menu with **Uninstall Hermes Bridge**.

The bridge contains no Hermes or model-provider credentials. It does contain the app's local pairing token, so removing it keeps Hermes Desktop tidy.

## Development

Source development requires Node.js 22 and npm.

```powershell
npm ci
npm test
npm run check
npm start
```

Create a verified Windows installer:

```powershell
npm run pack:win
```

The release audit runs automatically before packaging.

## Architecture

- Electron overlay: `src/`
- Hermes Desktop plugin template: `hermes-bridge/plugin.js`
- Protocol contract: `hermes-bridge/PROTOCOL.txt`
- Security and privacy tests: `test/`
- Release sanitization audit: `scripts/release-audit.js`

## Security

Please read [SECURITY.md](SECURITY.md). Do not include credentials, private logs, prompts, or session data in public bug reports.

## License

The application code and bundled sigil artwork are available under the [MIT License](LICENSE).

See [CHANGELOG.md](CHANGELOG.md) for release history.
