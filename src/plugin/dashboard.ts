import type { Activity, Command, SessionDetails, Snapshot } from "../shared/protocol.js";
import type { AppMcp, CompanionRequest, VoiceState } from "./companion.js";
import { icons } from "./icons.js";

export type Icon = keyof typeof icons;
export interface Tile {
  label: string;
  icon?: Icon;
  value?: string;
  activity?: Activity;
  disabled?: boolean;
  selected?: boolean;
  gauge?: number;
  recording?: boolean;
  /** Project colour token from the app, drawn as a strip on top of the tile. */
  accent?: string;
  action?: Action;
}
type View =
  | { type: "home"; page: number }
  | { type: "projects"; page: number }
  | { type: "sessions"; page: number; projectId?: string; favorites?: boolean; chats?: boolean; attention?: boolean }
  | { type: "session"; page: number; id: string; follow?: boolean }
  | { type: "mcp"; page: number; sessionId: string }
  | { type: "confirm"; page: number; command: Command; label: string; sessionId?: string; request?: CompanionRequest }
  | { type: "question"; page: number };
type Action =
  | { type: "view"; view: View }
  | { type: "back" | "previous" | "next" | "refresh" | "home" | "voice" }
  | { type: "companion"; request: CompanionRequest }
  | { type: "favorite"; id: string }
  | { type: "command"; command: Command };

const statusLabels: Partial<Record<Activity, string>> = {
  working: "Working", attention: "Needs you", ready: "Ready to merge", idle: "Idle", error: "Stopped",
};
const statusLabel = (activity?: Activity): string | undefined => activity && statusLabels[activity];

export class Dashboard {
  view: View = { type: "home", page: 0 };
  private history: View[] = [];
  snapshot?: Snapshot;
  error?: string;
  busy = false;
  loadingDetails = false;
  savedDetails?: SessionDetails;
  voice?: VoiceState;
  private openRequestedId?: string;
  favorites = new Set<string>();

  constructor(
    private execute: (command: Command) => Promise<void>,
    private persist: (ids: string[]) => Promise<void>,
    private send: (request: CompanionRequest) => Promise<void> = async () => { throw new Error("Companion API not connected"); },
  ) {}

  /** Home tile for a question the app's active session is waiting on. */
  private questionTile(fallback: Tile): Tile {
    const question = this.voice?.question;
    if (!question || !this.voice?.activeSessionId) return fallback;
    return {
      label: "Answer question", icon: "attention", activity: "attention",
      value: question.choices.length ? String(question.choices.length) : undefined,
      action: { type: "view", view: { type: "question", page: 0 } },
    };
  }

  /** The app's own MCP list, which only describes its active session. */
  private appMcp(sessionId: string): AppMcp[] | undefined {
    return this.voice?.activeSessionId === sessionId ? this.voice.mcp : undefined;
  }

  get targetSessionId(): string | undefined {
    return this.view.type === "session" ? this.sessionViewId(this.view)
      : this.view.type === "mcp" || this.view.type === "confirm" ? this.view.sessionId : undefined;
  }

  get detailsMessage(): string | undefined {
    if (this.view.type !== "session") return;
    const id = this.sessionViewId(this.view);
    if (this.snapshot && id !== this.snapshot.bridgeSessionId && this.voice?.active?.id === id) {
      return "Live values from the Copilot app for the session open in its window. MCP controls still need this session's bridge.";
    }
    if (this.loadingDetails) return "Loading details for the selected session.";
    if (this.snapshot && id !== this.snapshot.bridgeSessionId && this.savedDetails?.id === id) {
      return `Session is not running. Showing the last saved values${this.savedDetails.updatedAt ? ` from ${new Date(this.savedDetails.updatedAt).toLocaleString()}` : ""}, read from its local session history. MCP controls need the session to be running.`;
    }
    if (this.snapshot && id !== this.snapshot.bridgeSessionId) {
      return "No live bridge for this session. Copilot can stop an idle session's runtime and its extensions while keeping the conversation visible. Switching tabs does not guarantee a runtime starts. Session metrics and MCP controls require that runtime; app-wide activity status is still available. This connector cannot start it automatically.";
    }
    return this.snapshot?.capabilities.details.reason;
  }

  /** Dictation always goes to the session that is active in the app window. */
  voiceTile(sessionId?: string): Tile {
    const voice = this.voice;
    if (!voice) return { label: "Voice: turn on", icon: "mic", disabled: true };
    if (!voice.available) return { label: "Voice unavailable", icon: "mic", disabled: true };
    if (sessionId && voice.activeSessionId !== sessionId) return { label: "Open to talk", icon: "mic", disabled: true };
    return {
      label: voice.recording ? "Listening" : voice.mode === "push_to_talk" ? "Hold to talk" : "Tap to talk",
      icon: "mic", recording: voice.recording, action: { type: "voice" },
    };
  }

  isVoice(index: number): boolean {
    const tile = this.tiles()[index];
    return tile?.action?.type === "voice" && !tile.disabled;
  }

  /** "Active session" follows the session open in the app window, falling back to the bridge session. */
  private sessionViewId(view: { id: string; follow?: boolean }): string {
    return view.follow ? this.voice?.activeSessionId ?? this.snapshot?.bridgeSessionId ?? view.id : view.id;
  }

  private go(view: View): void {
    this.history.push(this.view);
    this.view = view;
  }

  tiles(): Tile[] {
    const data = this.snapshot;
    const tiles: Tile[] = Array.from({ length: 15 }, () => ({ label: "" }));
    const unavailable = (label: string, icon: Icon): Tile => ({ label, icon, disabled: true });
    const viewTile = (label: string, icon: Icon, view: View, disabled = false): Tile =>
      ({ label, icon, disabled, action: { type: "view", view } });
    let items: Tile[] = [];
    if (!data) {
      items = [{ label: "No bridge", icon: "error", activity: "error" }, unavailable("Open Copilot", "chat")];
    } else if (this.view.type === "home") {
      items = [
        this.voice
          ? viewTile("New", "plus", { type: "confirm", page: 0, command: { type: "newChat" }, request: { type: "session.new" }, label: "New" })
          : viewTile("New chat", "plus", { type: "confirm", page: 0, command: { type: "newChat" }, label: "Create chat?" }, !data.capabilities.newChat.available),
        viewTile("Projects", "folder", { type: "projects", page: 0 }, !data.capabilities.projects.available),
        viewTile("Sessions", "chat", { type: "sessions", page: 0 }, !data.capabilities.sessions.available),
        data.capabilities.appPins.available
          ? viewTile("Pinned", "pin", { type: "sessions", page: 0, favorites: true }, !data.capabilities.sessions.available)
          : viewTile("Favorites", "star", { type: "sessions", page: 0, favorites: true }, !data.capabilities.sessions.available),
        this.voice?.activeSessionId && this.voice.mcp
          ? viewTile("MCP servers", "grid", { type: "mcp", page: 0, sessionId: this.voice.activeSessionId })
          : viewTile("MCP servers", "grid", { type: "mcp", page: 0, sessionId: data.bridgeSessionId }, !data.capabilities.mcp.available),
        viewTile("Chats", "chat", { type: "sessions", page: 0, chats: true }, !data.capabilities.sessions.available),
        viewTile(this.voice?.activeSessionId ? "Active session" : "This session", "session", { type: "session", id: data.bridgeSessionId, follow: true, page: 0 }),
        this.voiceTile(),
        {
          ...viewTile("Needs you", "attention", { type: "sessions", page: 0, attention: true }, !data.capabilities.sessions.available),
          value: String(data.sessions.filter((row) => row.activity === "attention").length),
          activity: data.sessions.some((row) => row.activity === "attention") ? "attention" : undefined,
        },
        this.questionTile({ label: "Live sessions", value: String(data.sessions.filter((row) => row.activity === "working").length) }),
      ];
    } else if (this.view.type === "projects") {
      items = data.projects.map((project) => ({ ...viewTile(project.name, "folder", { type: "sessions", projectId: project.id, page: 0 }), accent: project.accent }));
    } else if (this.view.type === "sessions") {
      const view = this.view;
      items = data.sessions
        .filter((session) => (!view.projectId || session.projectId === view.projectId) &&
          (!view.favorites || session.pinned || this.favorites.has(session.id)) && (!view.chats || session.kind === "chat") &&
          (!view.attention || session.activity === "attention"))
        .map((session) => ({
          ...viewTile(session.name, "session", { type: "session", id: session.id, page: 0 }),
          value: initials(session.name), activity: session.activity,
          accent: session.accent ?? data.projects.find((project) => project.id === session.projectId)?.accent,
        }));
    } else if (this.view.type === "session") {
      const id = this.sessionViewId(this.view);
      const session = data.sessions.find((row) => row.id === id);
      const own = id === data.bridgeSessionId;
      const appLive = !own && this.voice?.active?.id === id ? this.voice.active : undefined;
      const saved = !own && !appLive && this.savedDetails?.id === id ? this.savedDetails : undefined;
      const details = own ? data.details : appLive ?? saved;
      const missing = this.loadingDetails && !appLive ? "Loading" : own || saved || appLive ? "Unavailable" : "No bridge";
      const requested = this.openRequestedId === id;
      items = [
        { label: requested ? "Open requested" : "Open in app", icon: "open", disabled: requested || !data.capabilities.openSession.available || !session, action: { type: "command", command: { type: "openSession", id } } },
        { label: this.favorites.has(id) ? "Unfavorite" : "Favorite", icon: "star", selected: this.favorites.has(id), action: { type: "favorite", id } },
        { label: "Model", value: details?.model ?? missing },
        { label: "Reasoning", value: details ? details.reasoning ?? "Default" : missing, disabled: !details },
        { label: "Context used", value: details?.contextPercent === undefined ? missing : `${details.contextPercent.toFixed(0)}%`, gauge: details?.contextPercent },
        { label: "Context limit", value: details?.contextLimit === undefined ? missing : formatTokens(details.contextLimit) },
        { label: details?.creditsStatus === "complete" ? "AI credits" : details ? "Credits (partial)" : "AI credits", value: details?.aiCredits === undefined ? missing : details.aiCredits.toFixed(1) },
        viewTile("MCP servers", "grid", { type: "mcp", page: 0, sessionId: id }, !this.appMcp(id) && (!own || !data.capabilities.mcp.available)),
        this.voiceTile(id),
        { label: this.loadingDetails && !appLive ? "Loading details" : statusLabel(session?.activity) ?? (own ? "Session status" : appLive ? "Live from app" : saved ? "Saved values" : "Bridge not running"), icon: "session", activity: session?.activity ?? "unknown" },
      ];
    } else if (this.view.type === "mcp") {
      const sessionId = this.view.sessionId;
      const app = this.appMcp(sessionId);
      items = app ? app.map((server): Tile => ({
        label: server.name, icon: "grid",
        value: server.enabled ? "ON" : "OFF",
        selected: server.enabled,
        disabled: !server.toggleable,
        action: { type: "view", view: { type: "confirm", page: 0,
          command: { type: "setMcp", name: server.name, enabled: !server.enabled },
          request: { type: "mcp.toggle", serverId: server.id }, sessionId,
          label: `${server.enabled ? "Disable" : "Enable"} ${server.name}?` } },
      })) : data.bridgeSessionId !== sessionId ? [] : data.mcp.map((server) => ({
        label: server.name, icon: "grid",
        value: server.enabled ? "ON" : "OFF",
        selected: server.enabled,
        activity: server.status === "failed" ? "error" : undefined,
        action: { type: "view", view: { type: "confirm", page: 0,
          command: { type: "setMcp", name: server.name, enabled: !server.enabled }, sessionId,
          label: `${server.enabled ? "Disable" : "Enable"} ${server.name}?` } },
      }));
    } else if (this.view.type === "question") {
      const question = this.voice?.question;
      const sessionId = this.voice?.activeSessionId;
      items = !question || !sessionId ? [{ label: "No question waiting", icon: "check", disabled: true }] : [
        ...question.choices.map((label, choiceIndex): Tile => ({
          label, value: String(choiceIndex + 1), activity: "attention",
          action: { type: "companion", request: { type: "question.answer", sessionId, questionToken: question.token, choiceIndex } },
        })),
        ...(question.custom ? [{ label: "Type answer", icon: "chat" as Icon,
          action: { type: "companion" as const, request: { type: "question.focus_custom" as const, sessionId, questionToken: question.token } } }] : []),
      ];
    } else if (this.view.type === "confirm" && this.view.request?.type === "session.new") {
      items = [
        { label: "In this project", icon: "folder", action: { type: "companion", request: this.view.request } },
        { label: "New chat", icon: "chat", disabled: !data.capabilities.newChat.available, action: { type: "command", command: { type: "newChat" } } },
        { label: "Cancel", icon: "back", action: { type: "back" } },
      ];
    } else if (this.view.type === "confirm") {
      const request = this.view.request;
      const command = this.view.command;
      // mcp.toggle flips the server, so only confirm while the app still shows the state this screen offered to change.
      const stale = request?.type === "mcp.toggle" && command.type === "setMcp" && !(this.appMcp(this.view.sessionId ?? "") ?? [])
        .some((server) => server.id === request.serverId && server.enabled !== command.enabled);
      items = [
        { label: stale ? "Changed in app" : "Confirm", icon: "check", disabled: stale, action: request
          ? { type: "companion", request }
          : { type: "command", command } },
        { label: "Cancel", icon: "back", action: { type: "back" } },
        { label: this.view.label, icon: this.view.command.type === "setMcp" ? "grid" : "plus" },
      ];
    }
    const maxPage = Math.max(0, Math.ceil(items.length / 10) - 1);
    this.view.page = Math.min(this.view.page, maxPage);
    items.slice(this.view.page * 10, this.view.page * 10 + 10).forEach((tile, index) => { tiles[index] = tile; });
    if (!items.length) tiles[0] = { label: "No items", icon: "chat", disabled: true };
    tiles[10] = { label: "Back", icon: "back", disabled: !this.history.length, action: { type: "back" } };
    tiles[11] = { label: "Previous", icon: "left", disabled: this.view.page === 0, action: { type: "previous" } };
    tiles[12] = { label: this.error ? "Error: see settings" : this.busy ? "Please wait" : `${this.view.type} ${this.view.page + 1}/${maxPage + 1}`,
      icon: this.error ? "error" : "home", activity: this.error ? "error" : this.busy ? "working" : undefined, action: { type: "home" } };
    tiles[13] = { label: "Refresh", icon: "refresh", action: { type: "refresh" } };
    tiles[14] = { label: "Next", icon: "right", disabled: this.view.page >= maxPage, action: { type: "next" } };
    return tiles;
  }

  async press(index: number): Promise<"refresh" | undefined> {
    if (this.busy) return;
    const tile = this.tiles()[index];
    if (!tile || tile.disabled || !tile.action) return;
    this.error = undefined;
    const action = tile.action;
    if (action.type !== "command" && action.type !== "favorite" && action.type !== "refresh") this.openRequestedId = undefined;
    switch (action.type) {
      case "home": this.view = { type: "home", page: 0 }; this.history = []; break;
      case "back": this.view = this.history.pop() ?? { type: "home", page: 0 }; break;
      case "previous": this.view.page = Math.max(0, this.view.page - 1); break;
      case "next": this.view.page++; break;
      case "view": this.go(action.view); break;
      case "refresh": return "refresh";
      case "voice": return;
      case "companion":
        this.busy = true;
        try {
          await this.send(action.request);
          if (this.view.type === "question" || this.view.type === "confirm") this.view = this.history.pop() ?? { type: "home", page: 0 };
        } finally {
          this.busy = false;
        }
        return;
      case "favorite": {
        const next = new Set(this.favorites);
        if (next.has(action.id)) next.delete(action.id); else next.add(action.id);
        await this.persist([...next]);
        this.favorites = next;
        break;
      }
      case "command":
        this.busy = true;
        try {
          await this.execute(action.command);
          if (action.command.type === "openSession") this.openRequestedId = action.command.id;
          if (this.view.type === "confirm") this.view = this.history.pop() ?? { type: "home", page: 0 };
          return "refresh";
        } finally {
          this.busy = false;
        }
    }
  }
}

export function initials(name: string): string {
  return name.split(/[\s:_-]+/).filter(Boolean).slice(0, 2).map((word) => [...word][0]).join("").toUpperCase();
}

function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}K` : String(tokens);
}
