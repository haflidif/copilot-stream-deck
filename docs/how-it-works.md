# How it works

The plugin connects to the **existing** GitHub Copilot app. It does not start an independent Copilot SDK runtime, scrape app databases or automate mouse clicks.

It has two sources of data:

- **The Companion device integration**, an experimental local API in the Copilot app (the same one the Logitech keypad uses). It provides the project and session lists from the app sidebar, push to talk, questions, and live values for the session open in the app window.
- **The session bridge**, a Copilot extension that runs inside each session's runtime and exposes that session's details on an authenticated loopback port.

The [integration findings](integration.md) describe the architecture and the APIs in more depth.

## Bridges and runtimes

Each runtime with the extension loaded starts its own bridge, so several can run at once. Automatic selection uses the bridge of the session that is active in the app when the companion API is on, then the newest bridge whose process is still running. The app also starts hidden warmup sessions that load the extension and are cleaned up shortly after, so following the active session keeps the deck off those.

If the default bridge closes, automatic selection reconnects to another running bridge. A connection that stops answering is looked up again once, so a reloaded bridge on a new port is picked up without an error. A bridge pinned in tile settings stays pinned. Selecting another session on the deck temporarily routes its details and MCP controls to its own bridge without changing that default.

A visible conversation is not proof that its runtime is running. Copilot can stop an idle session's runtime, which also stops its extensions, while keeping the conversation visible. In the observed app build this happened about ten minutes after the last activity. Switching tabs does not guarantee that the runtime starts again, and the current extension API has no verified way to wake another runtime without submitting work. Reinstalling the extension or refreshing Stream Deck will not change that.

A missing bridge is labelled **No bridge** and **Bridge not running**. When the Companion device integration is on, navigation and status keep working without a bridge.

## Saved values

When a session has no live bridge, the plugin falls back to that session's local history file (`%USERPROFILE%\.copilot\session-state\<id>\events.jsonl`). It reads the file without changing it, scanning backwards from the end, and shows the last saved model, context use, context limit and AI credits.

- These are the values from the session's last run, not live numbers. They are never copied from another session.
- The status tile follows the session's state (for example **Idle** or **Ready to merge**), and reads **Saved values** only when the state is unknown.
- Context use is the prompt size of the last model request. Credits marked partial come from the last usage checkpoint.
- Reasoning is only shown when the history contains a model change.
- MCP controls stay disabled until the session runs again.

## Open in app

Without the Companion device integration, **Open in app** fetches the session's `app_url` from Copilot's `list_sessions_and_chats` catalog and opens it through the registered Windows URL handler. Only a `ghapp://sessions/` link matching the selected session ID is accepted.

It does not call the agent's `navigate_to` tool, which can produce a "wants to switch you" prompt from background sessions. Once Windows accepts the launch, the tile says **Open requested** and ignores repeat presses until you leave the screen. This does not prove the app finished switching or started the session runtime, and it never approves a host prompt.

## Subagents

The Agents page needs the bridge (`npm run extension:install`, then reload extensions in the session) and a Copilot runtime that exposes the experimental task-list API. The companion feed alone does not provide subagent data.

- An absent or incompatible bridge shows an unavailable message, not an empty team. **No subagents** means the runtime returned an empty agent list.
- **Waiting** means a multi-turn agent is idle and can take another assignment. Finishing a response does not necessarily complete the whole task.
- Task snapshots refresh about every five seconds while the deck is visible.
- **Active session** follows the session open in the app. Sessions opened from the deck's session list stay selected.
- Prompts, agent responses and raw error messages are not forwarded to the deck.
