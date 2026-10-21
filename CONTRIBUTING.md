# Contributing

Thanks for your interest in Copilot Companion for Stream Deck. Bug reports, ideas, testing on other hardware and pull requests are all welcome.

This is a small project with one maintainer, [@haflidif](https://github.com/haflidif), who reviews and merges everything. Please be patient with response times.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to help

- **Report a bug.** Use the [bug report form](https://github.com/haflidif/copilot-stream-deck/issues/new?template=bug_report.yml). Plugin logs and the app and Stream Deck versions help a lot.
- **Suggest a feature.** Use the [feature request form](https://github.com/haflidif/copilot-stream-deck/issues/new?template=feature_request.yml) and describe the problem first, then the idea.
- **Test on other setups.** macOS and Stream Deck models other than the 15-key layout have had little testing. Feedback from real hardware is very valuable.
- **Improve the docs.** Fixes to the README and these guides are welcome, even small ones.
- **Pick up an issue.** Issues labelled [`good first issue`](https://github.com/haflidif/copilot-stream-deck/labels/good%20first%20issue) or [`help wanted`](https://github.com/haflidif/copilot-stream-deck/labels/help%20wanted) are a good place to start.

For larger changes, open an issue first so we can agree on the approach before you spend time on it.

Security problems should not go in a public issue. See [SECURITY.md](SECURITY.md).

## Development setup

You need:

- Node.js 20.19 or later
- The [Elgato Stream Deck app](https://www.elgato.com/downloads) and the [Stream Deck CLI](https://docs.elgato.com/streamdeck/cli/intro) (`npm install -g @elgato/cli`)
- The GitHub Copilot desktop app, if you want to test against live sessions

Clone your fork and install the dependencies:

```powershell
git clone https://github.com/<your-user>/copilot-stream-deck.git
cd copilot-stream-deck
npm ci
npm run validate
```

`npm run validate` runs the type check and the test suite. The [development guide](docs/development.md) covers previews, linking the plugin to your checkout, installing the Copilot extension and releases.

You don't need a physical Stream Deck for most work. `npm run preview` renders the real tile renderer with synthetic data to `dist\preview.svg`, and the tests cover the bridge, the protocol and the dashboard logic.

## Project layout

| Path | What it holds |
| --- | --- |
| `src/plugin/` | The Stream Deck plugin: actions, dashboard pages and tile rendering |
| `src/bridge/` | The Copilot extension that exposes session data on a loopback port |
| `src/shared/` | Code used by both, such as the protocol and paths |
| `tests/` | Node test runner tests (`*.test.ts`) |
| `scripts/` | Build, packaging, preview and install scripts |
| `com.haflidif.copilot.sdPlugin/` | The plugin manifest, images and built output |

## Making changes

1. Fork the repository and create a branch from `main`, for example `fix/model-label` or `feature/xl-layout`.
2. Keep the change focused. One fix or feature per pull request is easier to review.
3. Add or update tests when you change behaviour. Tests live in `tests/` and run with `npm test`.
4. Run `npm run validate` before you push.
5. Update the README when you change something a user would notice.
6. Open a pull request against `main` and fill in the template.

Commit messages should be short and written in the imperative, for example "Show the Squad logo on the Agents key". Squash or tidy up your commits if the history gets noisy.

## Guidelines

- **Keep it local and read-only by default.** The bridge only listens on `127.0.0.1` and requires a token. Don't add network calls to outside services, telemetry or anything that sends session content off the machine.
- **Don't act on the user's behalf without a key press.** Keys may open, show or toggle things the user asked for. They should not approve prompts, submit work or change sessions silently.
- **Respect trademarks.** Logos and names of GitHub, Elgato, model providers and other projects belong to their owners. If you add a third-party asset, check its license and add a credit to [NOTICE.md](NOTICE.md).
- **Mind the platforms.** The plugin is Windows-first with experimental macOS support. Use the helpers in `src/shared/paths.ts` instead of hard-coding paths.
- **No secrets.** Never commit tokens, bridge descriptors, session IDs from your own machine or logs that contain them.

## AI-assisted contributions

Using AI tools is fine. Please review what they produce, make sure you understand and have tested it, and mention it in the pull request.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE) that covers this project.
