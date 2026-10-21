# Local data and permissions

Everything stays on your machine. The plugin and the bridge talk over `127.0.0.1` only, and no GitHub credentials are entered into Stream Deck.

## What the bridge exposes

The bridge exposes project and session names, status, metrics and MCP server names. It does not expose conversation bodies, prompts, agent responses or credentials.

Native app tools and the Copilot runtime keep their own permission checks. No key approves plans, tool permissions, commits, pushes or merges.

## Pairing descriptors

Pairing descriptors are stored outside the repository at `%LOCALAPPDATA%\CopilotStreamDeck\bridges\<session-id>.json`. Each contains a random bearer token for that run and a local port. Do not share or commit these files.

- Descriptors are deleted when the extension shuts down normally, and a starting bridge removes files left behind by dead processes.
- Temporary app catalog probes can also load the extension and then end. Their descriptors do not represent conversation runtimes.

## Security model

The bridge listens only on `127.0.0.1`, rejects requests from browsers, and accepts only a fixed list of commands. It is meant for a trusted single-user desktop. Files inherit the permissions of your Windows user profile, and the token does not protect against another process already running as your user.

To report a security problem, see [SECURITY.md](../SECURITY.md).

## Other local files

- Favorites and tile settings are stored in Stream Deck's plugin settings.
- [Saved values](how-it-works.md#saved-values) are read, never written, from the Copilot app's session history.
