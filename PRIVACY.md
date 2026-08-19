# Privacy

Hermes Sigil Overlay is designed as a local visualization, not an analytics product.

## Network boundary

The overlay listens only on:

```text
http://127.0.0.1:8765
```

`127.0.0.1` is the local loopback interface. The application has no telemetry endpoint, advertising service, analytics SDK, account system, or cloud backend.

## Data processed inside Hermes Desktop

The desktop plugin observes Hermes lifecycle events. It may inspect a tool's internal identifier long enough to classify it into fixed visual categories. It also uses raw runtime session IDs transiently as in-memory map keys so activity follows the correct focused session. Raw tool and session identifiers are never included in the transmitted payload. Inactive session state is evicted after one hour and is never persisted by the plugin.

## Data sent to the local overlay

Only these fields can cross the local bridge:

- Protocol version
- Whether a Hermes session is active (`true` or `false`)
- Fixed activity categories
- Lifecycle status: idle, working, complete, waiting, or error
- A fixed error activity category, when known
- A local random pairing token

The receiver constructs a new object from this closed schema and discards every unrecognized field before rendering.

## Data never sent

- API keys, OAuth tokens, passwords, or credentials
- Hermes configuration or environment variables
- Prompts, answers, reasoning content, or message text
- File paths, file names, or file contents
- Tool arguments or tool results
- Terminal commands, stdout, or stderr
- URLs, webpage content, or browser history
- Raw Hermes session IDs
- Raw/custom tool names
- Stack traces or full error messages

## Local pairing token

On first launch, the overlay creates a cryptographically random token in its Electron user-data directory. It writes a rendered copy of the bundled plugin into each detected Hermes Desktop profile with that token embedded.

The token:

- Is generated independently on every user's machine
- Is not an API key and cannot access Hermes or a model provider
- Is never committed to this repository
- Is used only to authenticate local overlay events

## Stored settings

The overlay stores its position, size, opacity, animation preferences, and local bridge token in its own Electron user-data directory. It does not read Hermes credential files.

## Removal

The Windows uninstaller runs the overlay's bridge-removal mode before deleting the application. Portable/source users can choose **Uninstall Hermes Bridge** in the tray menu. Both paths remove generated plugin copies from detected Hermes Desktop profiles without deleting unrelated Hermes files.
