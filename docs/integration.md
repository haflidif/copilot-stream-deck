# Integration findings

Investigation date: 2026-10-18.

## What is actually available

There are two integrations, with different maturity:

1. **Elgato's supported Stream Deck SDK.** Actions receive key events and update key images. The installed Stream Deck app is 7.0.3, so this starter uses `@elgato/streamdeck` 2.1.2 with Node 20. Current SDK 3 documentation requires Stream Deck 7.1 and Node 24; using it would unnecessarily require an app upgrade.
2. **The installed Copilot app's experimental extension/session API.** A project extension joins an existing session with `joinSession()`. Its session RPC exposes model, context, usage, MCP configuration and native tool execution. This is not a published guarantee of Logitech's integration protocol, and availability must be checked per host.

The initial live probe successfully returned the app's configured projects, its active/inactive session status list, the attached session's selected model, context metrics, AI-credit usage, and configured MCP servers. No mock data is substituted in the shipped plugin.

## Feature matrix

| Video feature | Elgato surface | Copilot connection | Starter status / remaining requirement |
|---|---|---|---|
| Animated running-session tiles | Update SVG key images on a timer | App session activity | Implemented. Original six-dot frames; eight updates per second is a software target, not a verified hardware frame rate. |
| Projects matching the app | Paginated dashboard | Native `list_projects` tool | Implemented using the app's project IDs and names. |
| Session lists and live activity | Named tiles and status badges | Native `get_sessions_status` tool | Implemented, approximately five-second refresh. Working, attention, idle, error and unknown remain distinct. |
| Open/resume an existing conversation | Key press | Native `navigate_to` tool | Wired to opening the existing app session. It does not automatically submit a prompt or restart work. |
| Start a chat | Confirmation screen | Native `create_session` tool | Wired to an idle standalone local chat. No kickoff, cloud environment or code checkout. |
| Voice recording toggle | Microphone action can be represented | No verified host tool/RPC for app microphone control | Disabled. Needs a supported app command or documented shortcut with authoritative recording state. OS dictation is not equivalent. |
| Model and reasoning display | Text/image tiles | `session.rpc.model.getCurrent()` | Implemented for the attached bridge session. Auto stays Auto; routed models are not misrepresented as a selected model. |
| Context size and tier | Metric tiles | `metadata.contextInfo({promptTokenLimit: 0, outputTokenLimit: 0})`, current model | Usage percent and resolved allowance implemented. Zero arguments ask the runtime to resolve actual limits. Model context-tier configuration is carried in the protocol; no tier picker yet. |
| AI credits | Metric tile | `session.rpc.usage.getMetrics()` | Implemented using `totalNanoAiu / 1e9`. Incomplete accounting is labelled partial; premium-request counts are not passed off as credits. |
| MCP enable/disable | Two-step confirmation | `mcp.listConfigured()`, `enable({serverName})`, `disable({serverName})` | Implemented for the attached session, not a global configuration toggle. Policy refusals surface as errors. |
| App-pinned chats | Favorites screen could represent them | No verified pin-list or pin-mutation host API | Not mirrored. Local Favorites are deliberately named differently and stored in Stream Deck. |
| Model/reasoning changes | Selection screens | Installed SDK declares model list/switch and reasoning methods | Feasible follow-on, not wired. Needs model-specific allowed values, policy handling and busy-session behavior before adding controls. |
| App-aware layouts | Stream Deck app-associated profiles | Does not require a Copilot API | Manual profile association supported by Stream Deck. Not automatically installed or configured by this starter. |
| VS Code actions | Stream Deck hotkeys or a VS Code extension | VS Code commands/extension | Separate profile, not included in this starter. Context-aware editor actions need an editor integration rather than pretending the Copilot app API supplies editor selection. |
| Drag/drop actions and macros | Native Stream Deck configuration / Multi Actions | Depends on each action | Dashboard tiles are position-aware and require a dedicated 15-key page. They intentionally opt out of Multi Actions. Standalone configurable actions can follow separately. |
| Details for every existing session | Session-specific bridge routing | A joined extension owns its attached session only | Current bridge can browse/open all exposed app sessions but reads details only for itself. Full coverage requires an extension attached to each target or a supported app-wide detail API. |

The recording shows model/reasoning tiles but does not prove that pressing them changes values. The starter does not assume every displayed metric is an editable control.

## Architecture

```text
15-key Stream Deck
    |
Elgato Stream Deck app (SDK WebSocket)
    |
Copilot Companion plugin (Node 20)
    |
Authenticated HTTP on 127.0.0.1
    |
Copilot project extension (joined to its existing session)
    |
Session RPC and a small native-app-tool allowlist
```

Each bridge uses an ephemeral port and a random token. Its descriptor is session-specific and stored under the user's local application-data directory. The plugin chooses an explicit session ID or the newest descriptor. Multiple devices have independent navigation; Favorites and bridge selection are plugin-global.

The bridge does not proxy arbitrary tools, shell commands or prompts. Its only mutations are opening a known session, creating an idle chat, and setting the enabled state of a known MCP server. Chat creation and MCP changes require confirmation on the deck. Host permissions are not replaced or automatically approved.

App tools can return large responses through a host-generated spill file. The adapter reads only recognized `copilot-tool-output-*.txt` files directly under the OS temporary directory, checks size, and parses the JSON. Failed, malformed and truncated responses produce explicit capability errors.

Updates are demand-driven: no app polling while all dashboard keys are hidden. Rendering pauses when a page/profile disappears, unchanged static images are skipped, and overlapping renders/refreshes are coalesced. A disconnected bridge clears the live data so stale tiles cannot execute commands.

## What is needed for feature parity

- A supported voice start/stop command plus recording-state events.
- An app pin catalog and pin/unpin API.
- A supported way to get details and change settings across existing sessions, or opt-in extension deployment plus routing for each session.
- A model/reasoning/context picker respecting the host's actual catalog, limits and policy.
- A user-exported, hardware-verified default Stream Deck profile for easier setup, standalone configurable actions, and an optional VS Code integration.
- Physical checks of legibility, animation timing, navigation and reconnect behavior on the 15-key device.

A separate Copilot SDK runtime can run tasks independently, but it cannot be assumed to mirror the existing desktop app's projects, pins, microphone or sessions. It is not used as a hidden fallback.

## Evidence and references

- [GitHub's ambient intelligence article](https://github.blog/news-insights/company-news/the-next-developer-interface-is-ambient-intelligence/).
- [Logitech keypad demonstration](https://www.youtube.com/watch?v=EQeJj0hoPS8), plus the user-provided recording and transcript. These were used as behavior references, not copied assets.
- [Elgato getting started](https://docs.elgato.com/streamdeck/sdk/introduction/getting-started/).
- [Elgato key images](https://docs.elgato.com/streamdeck/sdk/guides/keys/): `setImage` supports SVG/data URLs, but not animated GIF playback. Animation uses successive frames.
- [Elgato profiles](https://docs.elgato.com/streamdeck/sdk/guides/profiles/): plugins can programmatically switch only to profiles bundled with that plugin, not arbitrary user profiles.
- [Elgato manifest reference](https://docs.elgato.com/streamdeck/sdk/references/manifest/).
- [Copilot SDK](https://github.com/github/copilot-sdk).
- [Copilot app documentation](https://docs.github.com/en/copilot/how-tos/github-copilot-app). The public app docs and announcements reviewed did not establish a third-party voice/pinned-chat control API.
- Installed app extension authoring guide and SDK declarations: `copilot-sdk\docs\extensions.md`, `docs\agent-author.md`, `extension.d.ts`, `generated\rpc.d.ts`. These describe `joinSession`, tool metadata/execution, model/current, metadata/contextInfo, usage/getMetrics and MCP configuration methods. The bridge was exercised against the installed app, not inferred solely from type declarations.

The app extension API is experimental. Future releases may rename methods, alter tool schemas or remove access. Capability failures must remain visible rather than silently falling back to simulated data.
