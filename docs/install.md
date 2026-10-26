# Install and set up

## Requirements

- Windows 10 or later, or macOS 13 or later with the macOS build (see [macOS](#macos)).
- Stream Deck software 6.6 or later.
- The original Stream Deck or MK.2 with 15 keys. Other layouts are not supported yet.
- A GitHub Copilot desktop app build that supports `@github/copilot-sdk/extension`, session RPC and app tool execution. This is an experimental, version-dependent integration.

## Install the plugin

The plugin is shared through GitHub Releases, not the Elgato Marketplace.

1. Download `com.haflidif.copilot.streamDeckPlugin` from the [latest release](https://github.com/haflidif/copilot-stream-deck/releases/latest) and double-click it. Stream Deck installs it.
2. In the GitHub Copilot app, turn on **Companion device integration** (Settings, Experiments). The deck reads projects and sessions from it.
3. If Stream Deck offers the bundled profile, accept it, then select **Copilot Companion** in the profile dropdown. All 15 keys are already configured. Installation leaves your current profile selected and does not replace your existing layouts.

The bundled profile is included from **v0.1.1**. If you already have the plugin installed, you can download `copilot-companion.streamDeckProfile` from the release and double-click it to import the ready-made layout. If your existing Copilot profile already works, keep using it.

The keys get their content from their physical position, so leave custom images unset. The profile contains no personal connection settings, device IDs or app associations, and you can edit it freely.

## Install the session bridge (optional)

The bridge is a Copilot extension that gives the deck live model, context and MCP controls for a session, sub-sessions, model switching and the Agents page. Without it, navigation and status still work through the Companion device integration.

The bridge is installed from source. You need Git and Node.js 20.19 or later. Check out the tag matching your installed plugin release so the plugin and bridge use the same version. The commands below are for v0.3.0 and work in PowerShell on Windows or a terminal on macOS.

Until v0.3.0 is published, its tag is not available. These instructions describe the upcoming stable release.

```sh
git clone https://github.com/haflidif/copilot-stream-deck.git
cd copilot-stream-deck
git checkout v0.3.0
npm ci
npm run extension:install
```

This builds the bridge and copies it to `%USERPROFILE%\.copilot\extensions\copilot-stream-deck\` on Windows or `~/.copilot/extensions/copilot-stream-deck/` on macOS, where Copilot runtimes can find it. Sessions that are already running need an extension reload to pick it up.

To update an existing installation, fetch tags, check out the tag matching the new plugin release, and reinstall the bridge. For example, when updating to v0.3.0:

```sh
git fetch origin --tags
git checkout v0.3.0
npm ci
npm run extension:install
```

Reload extensions or restart open Copilot sessions after updating. Release tags remain available after feature branches are deleted. Use `main` only when intentionally testing unreleased development changes.

At least one Copilot runtime must be running with the extension for the deck to connect to a bridge. [How it works](how-it-works.md) explains which bridge the deck picks and what happens when a session's runtime stops.

## macOS

macOS support starts with v0.3.0. Install the plugin and matching bridge from that release using the instructions above. v0.2.0 does not include macOS support.

Use macOS 13 or later, Stream Deck software 6.6 or later, and a supported 15-key Stream Deck. In the Copilot desktop app, enable **Companion device integration** under **Settings > Experiments**. Hold to talk also needs the app's voice model installed.

### Session bridge

The bridge is optional, but required for the Agents page and Squad detection, as well as bridge-backed model, reasoning and MCP controls. Live values for the session open in the app can come through the Companion device integration without it.

Use the same release tag on Windows and macOS. No separate macOS branch is needed.

### Confirmed on a Mac

[Jan Egil Ring (@janegilring)](https://github.com/haflidif/copilot-stream-deck/issues/1#issuecomment-6357065502) tested the macOS beta on a Mac mini M4 and confirmed installation and profile selection, opening the correct session, live model/reasoning/context/credits values, bridge discovery and the Agents count, hold-to-talk dictation, and the Working, Needs you and Finished indicators, including confetti. This confirms the tested setup, not every Mac or Copilot app version.

### Troubleshoot macOS

- **Agents shows Unavailable:** check that the bridge matches the plugin release and is loaded in the selected session. The v0.2.0 bridge writes pairing files to a different folder on macOS; rebuild from v0.3.0 or later. **0** means the bridge answered with no subagents, not a connection failure.
- **Live values are unavailable without a bridge:** use v0.3.0 or later and keep the target session open in the app with Companion device integration enabled. An early macOS beta had a bug that hid those values.
- **The bridge disappears after inactivity:** the session's runtime may have stopped. Refreshing the deck or reinstalling the extension does not wake it; see [Bridges and runtimes](how-it-works.md#bridges-and-runtimes).
- **Need diagnostic logs:** look in `~/Library/Application Support/com.elgato.StreamDeck/Plugins/com.haflidif.copilot.sdPlugin/logs`. Review logs before sharing because they can contain project and session names. Never share pairing files, which contain bearer tokens.

The macOS build stores pairing files in `~/Library/Application Support/CopilotStreamDeck/bridges`, keeps the extension and session history under `~/.copilot`, and opens session links with `/usr/bin/open`. Labels fall back from Segoe UI to Arial, so text may look slightly different from Windows.

## Tile settings

Select a tile in the Stream Deck app to open its settings. You can check the connection status and the attached session ID there. Leave the bridge ID blank to use automatic selection, or enter a session ID to pin a specific bridge.

## Switch automatically when Copilot is active

Stream Deck's built-in **Smart Profiles** can switch to the Copilot layout when the GitHub Copilot app is in the foreground. This is optional and only needs to be set up once.

1. Open GitHub Copilot, then open **Stream Deck > Preferences > Profiles**.
2. Select the **Copilot Companion** profile.
3. In the **Application** dropdown, choose **GitHub Copilot**. If it is not listed, choose **Other...** and locate the app's executable.
4. Leave **Make this my default profile** unchecked if you want to keep your normal default layout outside Copilot.
5. Close or minimize the Stream Deck configuration windows, then bring GitHub Copilot to the foreground.

Smart Profiles do not switch while the Stream Deck configuration window is open for editing. Keep your usual profile as the default for apps without an associated profile.

The bundled profile does not include this association because Stream Deck saves the full executable path, which can differ between computers. For more details, see Elgato's [Smart Profiles guide](https://help.elgato.com/hc/en-us/articles/360053419071-Elgato-Stream-Deck-Smart-Profiles).
