# Copilot Companion for Stream Deck

An unofficial, Windows-first companion for the GitHub Copilot desktop app, designed for the original 15-key Stream Deck and MK.2.

This is a working starter, not feature parity with Logitech's Copilot integration. It connects to the **existing app** through an experimental Copilot extension bridge. It does not start an independent Copilot SDK runtime, scrape app databases, or automate mouse clicks.

## Included

- A position-aware 5-by-3 dashboard with project and session browsing, paging, Back and Home.
- Animated blue-dot session tiles, readable labels, attention/error indicators and reduced motion.
- Sessions waiting for you get a pulsing amber border, and a **Needs you** home tile counts them and opens the list.
- Context use is shown as a ring that turns amber from 60% and red from 85%.
- App-wide project and session status, refreshed approximately every five seconds while keys are visible.
- Opening existing sessions in the app.
- A confirmed action to create an idle standalone local chat, without starting an agent or creating a code checkout.
- Model, reasoning, context usage, context limit and AI credits for the session running the bridge.
- Confirmed MCP enable/disable controls for that same session.
- Local favorites, stored in Stream Deck plugin settings.
- An authenticated loopback bridge, with no GitHub credentials entered into Stream Deck.

**Push to talk:** the mic tile uses the Copilot app's "Companion device integration" experiment (Settings, Experiments), the same local API the Logitech keypad uses. Turn it on and install the app's voice model. Hold the key to talk, release to stop. Dictation goes to the session that is active in the app window. The same feed gives live model, reasoning, context and credits for the session open in the app window, so that session shows live values even without its bridge. This API is undocumented and may change. With the experiment on, the home "This session" key becomes "Active session" and always follows the session open in the app window.
**Answer questions:** when the session open in the app window is waiting on a question, the home "Live sessions" key turns into a pulsing "Answer question" key. Press it to get one key per choice (the app only shares the start of each label), plus "Type answer" when free text is allowed, which moves focus to the app's answer box. A choice is sent as soon as you press it. This uses the same companion API.

**Not connected yet:** app-pinned chats, model/reasoning selection, and MCP control for sessions other than the attached bridge session. Unavailable features are explicitly marked. Idle does not mean completed.

See [the integration findings](docs/integration.md) for the complete feature matrix and remaining work.

## Requirements

- Windows 10 or later.
- Stream Deck software 6.6 or later. The starter targets SDK 2.1.2 and Node 20 to support the locally installed Stream Deck 7.0.3.
- Original Stream Deck or MK.2 with 15 keys. Other layouts are deliberately not supported yet.
- Node.js 20.19 or later for development.
- A GitHub Copilot app build supporting `@github/copilot-sdk/extension`, session RPC and app tool execution. This is an experimental, version-dependent integration.

## Build and use

Run these commands from the repository:

```powershell
npm config get registry
npm ci
npm run validate
npm run plugin:validate
npm run plugin:pack
```

Use your approved npm registry. This environment uses the configured internal Microsoft proxy.

1. Run `npm run extension:install`. This builds the bridge and copies it to `%USERPROFILE%\.copilot\extensions\copilot-stream-deck\`, making it discoverable by Copilot runtimes outside this repository. It does not start a runtime for every conversation in the sidebar. Existing running runtimes need an extension reload to discover it. Run the install command again after changing bridge code.
2. Install `dist\com.haflidif.copilot.streamDeckPlugin` by opening it in Windows.
3. In Stream Deck, create a **new dedicated profile**, preserving your existing layout.
4. Drag **Copilot Companion > Dashboard tile (15-key)** onto all 15 keys. The physical key positions determine their content. Leave custom images unset.
5. Select a tile to open its settings. Check the connection status and attached-session ID. Leave the bridge ID blank to select the most recently loaded bridge, or specify the ID for an unambiguous connection.

At least one Copilot runtime must be running with the extension for the deck to connect. A visible conversation is not proof that its runtime is running. If the default bridge closes, automatic selection reconnects to another running bridge; an explicitly pinned default stays pinned. Selecting a session on the deck reads its own model, context, credits and MCP controls when its bridge is running. Sessions without a bridge can still be opened in the app. Their metrics are unavailable unless the session's local history has saved values, which are shown and labelled as saved. They are never copied from another session.

Copilot can stop an idle session's CLI runtime, which also stops its extensions, while keeping the conversation visible. In the observed app build, the host logged an idle runtime shutdown about ten minutes after the last activity. Switching tabs does not guarantee that runtime starts again. The current session-extension API does not provide a verified way for this connector to wake another app runtime without submitting work. Repeated extension reinstalls or refreshing Stream Deck will not fix that lifecycle limitation. A missing bridge is labelled **No bridge** and **Bridge not running**; the session's activity status still comes from the app-wide session list when another bridge is connected.

When a session has no live bridge, the plugin falls back to that session's local history file (`%USERPROFILE%\.copilot\session-state\<id>\events.jsonl`). It reads the file without changing it, scanning backwards from the end, and shows the last saved model, context use, context limit and AI credits. The status tile then reads **Saved values**. These are the values from the session's last run, not live numbers. Context use is the prompt size of the last model request, and credits marked partial come from the last usage checkpoint. Reasoning is only shown when the history contains a model change. MCP controls stay disabled until the session runs again.

**Open in app** fetches the session's `app_url` from Copilot's `list_sessions_and_chats` catalog and opens that link through the registered Windows URL handler. Only a `ghapp://sessions/` link matching the selected session ID is accepted. It does not call the agent's `navigate_to` tool, which can produce a "wants to switch you" prompt from background sessions. After Windows accepts the launch the tile says **Open requested** and ignores repeat presses until you leave the screen. This does not prove the app finished switching or started the session runtime, and does not approve any host prompt.

The bottom row is always **Back, Previous, Home/status, Refresh, Next**. The top two rows display up to ten items per page.

The plugin does not replace existing hardware profiles or set up automatic switching. You can associate this profile with the Copilot app in Stream Deck's profile settings. A separate VS Code profile can use editor hotkeys; that is distinct from Copilot session integration.

## Development

```powershell
npm run typecheck
npm test
npm run build
npm run plugin:validate
```

`npm run preview` creates `dist\preview.svg`, showing the actual tile renderer with clearly labelled synthetic data.

`npm run plugin:link` is an optional Elgato development link to this checkout. Use it instead of installing a packaged copy, not in addition to one. After rebuilding, restart the plugin through the Elgato CLI or Stream Deck app. Reinstall the Copilot extension with `npm run extension:install` after changing bridge code.

The Elgato CLI can report a successful restart even when the running plugin does not restart. Confirm the process actually restarted or check for a new plugin connection in Stream Deck's log. If it did not restart, quit Stream Deck from its system-tray menu and reopen it; reinstalling the plugin is unnecessary.

The automated checks cover rendering, navigation, feature gating, protocol validation, native tool-result decoding, local HTTP authentication and the compiled plugin's Stream Deck WebSocket lifecycle. Physical display quality, animation smoothness, voice support and the complete Logitech workflow still require further work and hardware use.

## Local data and permissions

Pairing descriptors are stored outside the repository at `%LOCALAPPDATA%\CopilotStreamDeck\bridges\<session-id>.json`. Each contains an ephemeral random bearer token and a local port. Do not share or commit those files. Each runtime with the extension loaded starts its own bridge, so several descriptors can exist at once. Temporary app catalog probes can also load the extension and then terminate; their descriptors do not represent persistent conversation runtimes. Descriptors are deleted on a normal extension shutdown, and a starting bridge removes files left behind by dead processes. Automatic selection initially uses the newest bridge whose process is still running, then keeps that connection until it fails. Pin one by session ID in tile settings to choose the default for "This session" and the home MCP button. Selecting another session temporarily routes its details and MCP controls to its own bridge without changing that default.

The bridge listens only on `127.0.0.1`, rejects browser-origin requests, and has a fixed command allowlist. It is intended for a trusted single-user desktop. File permissions inherit Windows user-profile ACLs; the token is not protection against another process already running as that user.

The bridge exposes project/session names, status, metrics and MCP names, not conversation bodies or credentials. Native app tools and the Copilot runtime retain their permission checks. No button approves plans, tool permissions, commits, pushes or merges.

This project is not an official GitHub or Elgato product. The six-dot graphics are original assets, not extracted Logitech artwork.

## Icons

Tile icons come from [GitHub Primer Octicons](https://github.com/primer/octicons) (MIT License, Copyright GitHub Inc.). `npm run icons` regenerates `src/plugin/icons.ts` with only the icons the deck uses. The GitHub and Copilot logos are trademarks and are not used.
