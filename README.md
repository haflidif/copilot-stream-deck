# Copilot Companion for Stream Deck

An unofficial, Windows-first companion for the GitHub Copilot desktop app, designed for the original 15-key Stream Deck and MK.2.

This is a working starter, not feature parity with Logitech's Copilot integration. It connects to the **existing app** through an experimental Copilot extension bridge. It does not start an independent Copilot SDK runtime, scrape app databases, or automate mouse clicks.

## Included

- A position-aware 5-by-3 dashboard with project and session browsing, paging, Back and Home.
- Animated blue-dot session tiles, readable labels, attention/error indicators and reduced motion.
- App-wide project and session status, refreshed approximately every five seconds while keys are visible.
- Opening existing sessions in the app.
- A confirmed action to create an idle standalone local chat, without starting an agent or creating a code checkout.
- Model, reasoning, context usage, context limit and AI credits for the session running the bridge.
- Confirmed MCP enable/disable controls for that same session.
- Local favorites, stored in Stream Deck plugin settings.
- An authenticated loopback bridge, with no GitHub credentials entered into Stream Deck.

**Not connected yet:** voice recording, app-pinned chats, model/reasoning selection, and details/MCP control for sessions other than the attached bridge session. Unavailable features are explicitly marked. Idle does not mean completed.

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

1. Open this repository in the Copilot app. After building, reload extensions with the app's extension tooling, or restart the session. The project extension lives at `.github\extensions\stream-deck\extension.mjs`; its generated `bridge.mjs` is created by `npm run build`.
2. Install `dist\com.haflidif.copilot.streamDeckPlugin` by opening it in Windows.
3. In Stream Deck, create a **new dedicated profile**, preserving your existing layout.
4. Drag **Copilot Companion > Dashboard tile (15-key)** onto all 15 keys. The physical key positions determine their content. Leave custom images unset.
5. Select a tile to open its settings. Check the connection status and attached-session ID. Leave the bridge ID blank to select the most recently loaded bridge, or specify the ID for an unambiguous connection.

The bridge must stay running in the Copilot app. Closing its session disconnects the hardware. When another session is selected on the deck, it can be opened in the app, but it does not inherit the bridge session's metrics or MCP controls.

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

`npm run plugin:link` is an optional Elgato development link to this checkout. Use it instead of installing a packaged copy, not in addition to one. After rebuilding, restart the plugin through the Elgato CLI or Stream Deck app. Reload the Copilot extension after rebuilding its bridge.

The automated checks cover rendering, navigation, feature gating, protocol validation, native tool-result decoding, local HTTP authentication and the compiled plugin's Stream Deck WebSocket lifecycle. Physical display quality, animation smoothness, voice support and the complete Logitech workflow still require further work and hardware use.

## Local data and permissions

Pairing descriptors are stored outside the repository at `%LOCALAPPDATA%\CopilotStreamDeck\bridges\<session-id>.json`. Each contains an ephemeral random bearer token and a local port. Do not share or commit those files. They are deleted on a normal extension shutdown; a forced crash may leave a stale file. If automatic selection chooses a stale bridge, select a running bridge by session ID in tile settings.

The bridge listens only on `127.0.0.1`, rejects browser-origin requests, and has a fixed command allowlist. It is intended for a trusted single-user desktop. File permissions inherit Windows user-profile ACLs; the token is not protection against another process already running as that user.

The bridge exposes project/session names, status, metrics and MCP names, not conversation bodies or credentials. Native app tools and the Copilot runtime retain their permission checks. No button approves plans, tool permissions, commits, pushes or merges.

This project is not an official GitHub or Elgato product. The six-dot graphics are original assets, not extracted Logitech artwork.
