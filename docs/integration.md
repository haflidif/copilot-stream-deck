# Integration findings

Investigation date: 2026-10-18.

## What is actually available

There are two integrations, with different maturity:

1. **Elgato's supported Stream Deck SDK.** Actions receive key events and update key images. The installed Stream Deck app is 7.0.3, so this starter uses `@elgato/streamdeck` 2.1.2 with Node 20. Current SDK 3 documentation requires Stream Deck 7.1 and Node 24; using it would unnecessarily require an app upgrade.
2. **The installed Copilot app's experimental extension/session API.** A user-level extension joins the runtime that loads it with `joinSession()`. A visible conversation does not necessarily have a running runtime. Its session RPC exposes model, context, usage, MCP configuration and native tool execution. This is not a published guarantee of Logitech's integration protocol, and availability must be checked per host.

The initial live probe successfully returned the app's configured projects, its active/inactive session status list, the attached session's selected model, context metrics, AI-credit usage, and configured MCP servers. No mock data is substituted in the shipped plugin.

## Feature matrix

| Video feature | Elgato surface | Copilot connection | Starter status / remaining requirement |
|---|---|---|---|
| Animated running-session tiles | Update SVG key images on a timer | App session activity | Implemented. Original six-dot frames; eight updates per second is a software target, not a verified hardware frame rate. |
| Projects matching the app | Paginated dashboard | Native `list_projects` tool | Implemented using the app's project IDs and names. |
| Session lists and live activity | Named tiles and status badges | Native `get_sessions_status` tool | Implemented, approximately five-second refresh. Working, attention, idle, error and unknown remain distinct. |
| Open/resume an existing conversation | Key press | `app_url` from `list_sessions_and_chats`, registered Windows URL handler | Opens the app-provided session link, not an agent navigation request. It does not automatically submit a prompt or restart work. |
| Start a chat | Confirmation screen | Native `create_session` tool | Wired to an idle standalone local chat. No kickoff, cloud environment or code checkout. |
| Voice recording toggle | Mic tile: push to talk or tap to talk | App "Companion device integration" experiment: `%USERPROFILE%\.copilot\run\logitech-voice-actions-v1.json` and `logitech-navigation-v1.json` (loopback WebSocket, Bearer token) | Sends `{"type":"voice.toggle","requestId":"<uuid>"}` and expects `voice.toggle.ack` with status `executed`. Recording state and mode come from the navigation snapshot `voiceDictation`. Undocumented, so all fields are validated. |
| Answer pending question | Home "Answer question" tile, then one tile per choice and "Type answer" | Navigation snapshot `activeSession.pendingQuestion` (`token`, `choiceCount`, `choiceLabelPrefixes`, `customInputAvailable`) and `logitech-session-actions-v1.json` | Sends `{"type":"question.answer","requestId","sessionId","questionToken","choiceIndex"}` with a 0-based `choiceIndex` (verified live), or `question.focus_custom` without `choiceIndex`. Expects `<type>.ack` with status `executed`. Only the app's active session is covered. |
| Open session, new session | "Open in app" and home "New", then "In this project" | `logitech-session-actions-v1.json` | `{"type":"session.open","requestId","sessionId"}` switches the app window to the session; falls back to the bridge `ghapp://` deep link on failure. `{"type":"session.new","requestId"}` creates a new session in the project the app window is showing (verified live), so the deck asks for confirmation first. Both expect `<type>.ack` with status `executed`. || Model and reasoning display | Text/image tiles | `session.rpc.model.getCurrent()` | Implemented for the attached bridge session. Auto stays Auto; routed models are not misrepresented as a selected model. |
| Context size and tier | Metric tiles | `metadata.contextInfo({promptTokenLimit: 0, outputTokenLimit: 0})`, current model | Usage percent and resolved allowance implemented. Zero arguments ask the runtime to resolve actual limits. Model context-tier configuration is carried in the protocol; no tier picker yet. |
| AI credits | Metric tile | `session.rpc.usage.getMetrics()` | Implemented using `totalNanoAiu / 1e9`. Incomplete accounting is labelled partial; premium-request counts are not passed off as credits. |
| MCP enable/disable | Two-step confirmation | `mcp.listConfigured()`, `enable({serverName})`, `disable({serverName})` | Implemented for the attached session, not a global configuration toggle. Policy refusals surface as errors. |
| App-pinned chats | Favorites screen could represent them | No verified pin-list or pin-mutation host API | Not mirrored. Local Favorites are deliberately named differently and stored in Stream Deck. |
| Model/reasoning changes | Selection screens | Installed SDK declares model list/switch and reasoning methods | Feasible follow-on, not wired. Needs model-specific allowed values, policy handling and busy-session behavior before adding controls. |
| App-aware layouts | Stream Deck app-associated profiles | Does not require a Copilot API | Manual profile association supported by Stream Deck. Not automatically installed or configured by this starter. |
| VS Code actions | Stream Deck hotkeys or a VS Code extension | VS Code commands/extension | Separate profile, not included in this starter. Context-aware editor actions need an editor integration rather than pretending the Copilot app API supplies editor selection. |
| Drag/drop actions and macros | Native Stream Deck configuration / Multi Actions | Depends on each action | Dashboard tiles are position-aware and require a dedicated 15-key page. They intentionally opt out of Multi Actions. Standalone configurable actions can follow separately. |
| Details for existing sessions | Session-specific bridge routing | A joined extension owns its attached runtime only | Selecting a session uses its running bridge for metrics and MCP controls. Sessions without a bridge remain browsable/openable but show no metrics. Idle runtime shutdown also stops the bridge; tab selection does not guarantee it restarts. |

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
Copilot user extension (one per loaded runtime, joined to that runtime)
    |
Session RPC and a small native-app-tool allowlist
```

Each bridge uses an ephemeral port and a random token. Its descriptor is session-specific and stored under the user's local application-data directory. The plugin chooses an explicit session ID first, then the app's active session from the companion API, then the newest live descriptor. The active session comes before the newest descriptor because the app's hidden warmup sessions also start short-lived bridges. It retains that connection until it fails, and a failed read gets one fresh lookup. Selecting a session temporarily routes details and MCP controls to that session's bridge. MCP confirmations retain that target; a missing bridge rejects the change rather than applying it to the default session. Multiple devices have independent navigation; Favorites and default bridge selection are plugin-global.

The bridge does not proxy arbitrary tools, shell commands or prompts. Its only mutations are opening a known session, creating an idle chat, and setting the enabled state of a known MCP server. Chat creation and MCP changes require confirmation on the deck. Host permissions are not replaced or automatically approved.

App tools can return large responses through a host-generated spill file. The adapter reads only recognized `copilot-tool-output-*.txt` files directly under the OS temporary directory, checks size, and parses the JSON. Failed, malformed and truncated responses produce explicit capability errors.

Updates are demand-driven: no app polling while all dashboard keys are hidden. Rendering pauses when a page/profile disappears, unchanged static images are skipped, and overlapping renders/refreshes are coalesced. A disconnected bridge clears the live data so stale tiles cannot execute commands.

If the user selects another session during a refresh, the obsolete result or error is discarded and the latest target is fetched immediately, without waiting for the next polling interval. Sessions without their own running bridge show an explicit missing-bridge label, while their app-wide activity status remains visible.

User-level installation changes discovery scope, not runtime lifetime. The app log showed `idle_cli_reap_check` destroying a real session runtime about ten minutes after it became idle and stopping its CLI process. Its extension log reported `disposition=stopped-normally`. The app also created short-lived `canvas-catalog-probe` runtimes with separate CLI session IDs; those bridge launches are not evidence that the displayed conversation has a persistent bridge. This connector has no verified session-extension API to wake another app runtime without submitting work. An app-level integration or supported runtime wake/detail API is needed for seamless metrics when browsing inactive conversations. It must not be replaced with fake prompts, runtime keepalive traffic or independent SDK sessions presented as the app's sessions.

As a partial fallback, the plugin reads the last `session.usage_record`, `session.model_change`, `session.shutdown` and `session.usage_checkpoint` events from the session's local `events.jsonl`. The read is backwards from the end of the file and capped at 16 MB. The file format is not a documented API, so values are labelled as saved, and missing fields fall back to the normal unavailable labels. The app's `get_session` tool was checked and returns no model, context or credit data.

Navigation fetches the selected session's `app_url` through `list_sessions_and_chats` and dispatches it through the registered Windows URL handler. The link must exactly match the selected session's `ghapp://sessions/` route; arbitrary URLs are rejected. This uses the external app-link entry point rather than `navigate_to`, whose background-agent requests can trigger switch confirmation. The plugin labels an accepted launch **Open requested** and suppresses repeat opens on that screen. Successful dispatch is not proof of completed app navigation or runtime startup, and no host prompt is approved automatically.

## What is needed for feature parity

- An app pin catalog and pin/unpin API.
- A supported app-wide detail API for sessions that do not have a running extension bridge.
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
