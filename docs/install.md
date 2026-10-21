# Install and set up

## Requirements

- Windows 10 or later.
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

The bridge is installed from source. You need Node.js 20.19 or later.

```powershell
git clone https://github.com/haflidif/copilot-stream-deck.git
cd copilot-stream-deck
npm ci
npm run extension:install
```

This builds the bridge and copies it to `%USERPROFILE%\.copilot\extensions\copilot-stream-deck\`, where Copilot runtimes can find it. Sessions that are already running need an extension reload to pick it up. Run the install command again after updating.

At least one Copilot runtime must be running with the extension for the deck to connect to a bridge. [How it works](how-it-works.md) explains which bridge the deck picks and what happens when a session's runtime stops.

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
