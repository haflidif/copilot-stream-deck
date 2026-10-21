# Development

See [CONTRIBUTING.md](../CONTRIBUTING.md) for how to propose changes. This page covers building, testing and releasing.

## Tooling

- Node.js 20.19 or later. Use your usual npm registry.
- The [Stream Deck CLI](https://docs.elgato.com/streamdeck/cli/intro) for validating, linking and packing.
- The plugin targets Stream Deck SDK 2.1.2 with Node 20, so it runs on Stream Deck 6.6 and later. SDK 3 needs Stream Deck 7.1 and Node 24.

## Build and test

```powershell
npm config get registry
npm ci
npm run validate
```

| Command | What it does |
| --- | --- |
| `npm run typecheck` | Type checks the project |
| `npm test` | Builds and runs the tests in `tests/` |
| `npm run validate` | Runs both of the above |
| `npm run build` | Builds the plugin and the bridge |
| `npm run plugin:validate` | Runs the Elgato validator on the plugin folder |
| `npm run plugin:pack` | Packs the plugin into `dist` |
| `npm run extension:install` | Builds the bridge and installs it as a Copilot extension |

The tests cover rendering, navigation, feature gating, protocol validation, native tool-result decoding, local HTTP authentication and the compiled plugin's Stream Deck WebSocket lifecycle. Display quality, animation smoothness and voice still need testing on real hardware.

## Try your changes

To try a build on your own deck:

1. Run `npm run extension:install` if you changed bridge code, then reload extensions in a Copilot session.
2. Run `npm run release` and double-click `dist\com.haflidif.copilot.streamDeckPlugin`.

`npm run plugin:link` is an optional alternative that links Stream Deck to this checkout. Use it instead of an installed copy, not alongside one. After rebuilding, restart the plugin through the Elgato CLI or the Stream Deck app.

The Elgato CLI can report a successful restart even when the plugin did not restart. Check that the process actually restarted, or look for a new plugin connection in Stream Deck's log. If it did not, quit Stream Deck from the system tray and open it again. Reinstalling the plugin is not needed.

## Previews, screenshots and the GIF

You don't need a Stream Deck to see the tiles. These commands use the real renderer with made-up demo data:

| Command | Output |
| --- | --- |
| `npm run preview` | `dist\preview.svg`, with clearly labelled synthetic data |
| `npm run screenshots` | The pictures in `docs/images` |
| `npm run gif` | `docs/images/navigation.gif` |

## Icons

Tile icons come from [GitHub Primer Octicons](https://github.com/primer/octicons). `npm run icons` regenerates `src/plugin/icons.ts` with only the icons the deck uses. Icons and values use GitHub Primer colours, and the Copilot icon uses a purple to blue gradient. Status colours (attention, error, finished) and project colours always take priority.

The provider logos on the Model key are kept in `src/plugin/brands.ts`. Credits and trademarks are listed in [NOTICE.md](../NOTICE.md).

## Release

```powershell
npm run release
```

This builds without the source map, generates and bundles the 15-key profile, runs the Elgato validator and writes `dist\com.haflidif.copilot.streamDeckPlugin`. It also writes `dist\copilot-companion.streamDeckProfile` for people who already have the plugin installed.

Before running it, bump `Version` in `com.haflidif.copilot.sdPlugin/manifest.json` (four numbers, for example `0.3.0.0`) and `version` in `package.json`. Then attach both files to a GitHub Release.

The packaging follows Elgato's [bundled profiles guide](https://docs.elgato.com/streamdeck/sdk/guides/profiles/).
