import type { Activity, Command, SessionDetails, Snapshot } from "../shared/protocol.js";
import type { AppMcp, CompanionRequest, VoiceState } from "./companion.js";
import { icons } from "./icons.js";

export type Icon = keyof typeof icons;
export type Tone = "copilot" | "blue" | "gold" | "green" | "muted";
export interface Tile {
  label: string;
  icon?: Icon;
  value?: string;
  activity?: Activity;
  disabled?: boolean;
  selected?: boolean;
  gauge?: number;
  /** Ring fill to draw this frame while it animates toward `gauge`. */
  ring?: number;
  /** Model provider; draws a badge in place of the value text. */
  provider?: Provider;
  recording?: boolean;
  /** Project colour token from the app, drawn as a strip on top of the tile. */
  accent?: string;
  /** Colour for the value text when no status colour applies. */
  tone?: Tone;
  /** Just finished working; drawn as a green flashing border. */
  flash?: boolean;
  /** Number of sub-sessions grouped under this tile; drawn as a "+N" badge. */
  children?: number;
  /** A sub-session shown on its parent's page; drawn with a nesting mark. */
  nested?: boolean;
  /** Busy session count; draws an animated Copilot that dozes off when nothing is running. */
  busy?: number;
  action?: Action;
}
type View =
  | { type: "home"; page: number }
  | { type: "projects"; page: number }
  | { type: "sessions"; page: number; projectId?: string; favorites?: boolean; chats?: boolean; attention?: boolean; finished?: boolean; working?: boolean; parentId?: string }
  | { type: "session"; page: number; id: string; follow?: boolean }
  | { type: "mcp"; page: number; sessionId: string }
  | { type: "models"; page: number; sessionId: string }
  | { type: "reasoning"; page: number; sessionId: string; modelId?: string }
  | { type: "confirm"; page: number; command: Command; label: string; sessionId?: string; request?: CompanionRequest }
  | { type: "question"; page: number };

const viewTitles: Record<View["type"], string> = {
  home: "Home", projects: "Projects", sessions: "Sessions", session: "Session", mcp: "MCP",
  models: "Models", reasoning: "Mode", confirm: "Confirm", question: "Question",
};
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
  /** A finished session flashes until it is opened on the deck, or for at most this long. */
  static readonly finishedMs = 5 * 60_000;
  now: () => number = Date.now;
  private lastActivity = new Map<string, string>();
  private finishedAt = new Map<string, number>();
  reducedMotion = false;
  private ring?: { id: string; shown: number };

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

  /** True when the one session waiting on you is open in the app with a question, so Needs you can go straight to it. */
  private onlyWaitingIsQuestion(sessions: Snapshot["sessions"]): boolean {
    const waiting = sessions.filter((row) => row.activity === "attention");
    return waiting.length === 1 && Boolean(this.voice?.question) && this.voice?.activeSessionId === waiting[0]!.id;
  }

  /** The app's own MCP list, which only describes its active session. */
  private appMcp(sessionId: string): AppMcp[] | undefined {
    return this.voice?.activeSessionId === sessionId ? this.voice.mcp : undefined;
  }

  get targetSessionId(): string | undefined {
    return this.view.type === "session" ? this.sessionViewId(this.view)
      : this.view.type === "mcp" || this.view.type === "confirm" || this.view.type === "models" || this.view.type === "reasoning" ? this.view.sessionId : undefined;
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

  /** Notes sessions that went from working to idle or ready, so their tiles can flash for a moment. */
  private trackFinished(sessions: Snapshot["sessions"]): void {
    const now = this.now();
    for (const session of sessions) {
      if (this.lastActivity.get(session.id) === "working" && (session.activity === "idle" || session.activity === "ready")) {
        this.finishedAt.set(session.id, now);
      } else if (session.activity === "working") {
        this.finishedAt.delete(session.id);
      }
      this.lastActivity.set(session.id, session.activity);
    }
    for (const [id, at] of this.finishedAt) if (now - at >= Dashboard.finishedMs) this.finishedAt.delete(id);
  }

  private finished(id: string): boolean {
    return this.finishedAt.has(id);
  }

  /** Moves the drawn context ring a step toward the real value; a newly opened session fills up from empty. */
  private easeRing(id: string, target: number | undefined): number | undefined {
    if (target === undefined || !Number.isFinite(target)) {
      this.ring = undefined;
      return undefined;
    }
    const goal = Math.min(100, Math.max(0, target));
    const from = this.ring?.id === id ? this.ring.shown : 0;
    const shown = this.reducedMotion || Math.abs(goal - from) < 1 ? goal : from + (goal - from) * 0.35;
    this.ring = { id, shown };
    return shown;
  }

  tiles(): Tile[] {
    const data = this.snapshot;
    if (data) this.trackFinished(data.sessions);
    if (this.view.type === "session") this.finishedAt.delete(this.sessionViewId(this.view));
    else this.ring = undefined;
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
          ? viewTile("New", "sparkle", { type: "confirm", page: 0, command: { type: "newChat" }, request: { type: "session.new" }, label: "New" })
          : viewTile("New chat", "sparkle", { type: "confirm", page: 0, command: { type: "newChat" }, label: "Create chat?" }, !data.capabilities.newChat.available),
        viewTile("Projects", "folder", { type: "projects", page: 0 }, !data.capabilities.projects.available),
        viewTile("Sessions", "copilot", { type: "sessions", page: 0 }, !data.capabilities.sessions.available),
        data.capabilities.appPins.available
          ? viewTile("Pinned", "pin", { type: "sessions", page: 0, favorites: true }, !data.capabilities.sessions.available)
          : viewTile("Favorites", "star", { type: "sessions", page: 0, favorites: true }, !data.capabilities.sessions.available),
        this.voice?.activeSessionId && this.voice.mcp
          ? viewTile("MCP servers", "server", { type: "mcp", page: 0, sessionId: this.voice.activeSessionId })
          : viewTile("MCP servers", "server", { type: "mcp", page: 0, sessionId: data.bridgeSessionId }, !data.capabilities.mcp.available),
        viewTile("Chats", "chat", { type: "sessions", page: 0, chats: true }, !data.capabilities.sessions.available),
        viewTile(this.voice?.activeSessionId ? "Active session" : "This session", "copilot", { type: "session", id: data.bridgeSessionId, follow: true, page: 0 }),
        (() => {
          const busy = data.sessions.filter((row) => row.activity === "working").length;
          return { ...viewTile(busy ? "Working" : "Sleeping", "session", { type: "sessions", page: 0, working: true }, !data.capabilities.sessions.available), busy };
        })(),
        {
          ...viewTile("Needs you", "attention", this.onlyWaitingIsQuestion(data.sessions)
            ? { type: "question", page: 0 }
            : { type: "sessions", page: 0, attention: true }, !data.capabilities.sessions.available),
          value: String(data.sessions.filter((row) => row.activity === "attention").length), tone: "muted",
          activity: data.sessions.some((row) => row.activity === "attention") ? "attention" : undefined,
        },
        this.questionTile(this.finishedAt.size
          ? { label: "Finished", icon: "check", activity: "ready", flash: true, value: this.finishedAt.size > 1 ? String(this.finishedAt.size) : undefined,
            action: { type: "view", view: { type: "sessions", page: 0, finished: true } } }
          : { label: "" }),
      ];
    } else if (this.view.type === "projects") {
      items = data.projects.map((project) => ({ ...viewTile(project.name, "folder", { type: "sessions", projectId: project.id, page: 0 }), accent: project.accent }));
    } else if (this.view.type === "sessions") {
      const view = this.view;
      const ids = new Set(data.sessions.map((row) => row.id));
      const nested = (session: { parentId?: string }) => !!session.parentId && ids.has(session.parentId);
      const children = (id: string) => data.sessions.filter((row) => row.parentId === id).length;
      // Status lists stay flat so a busy or waiting sub-session is never hidden behind its parent.
      const flat = view.attention || view.finished || view.working;
      const rows = view.parentId
        ? data.sessions.filter((row) => row.id === view.parentId || row.parentId === view.parentId)
          .sort((a, b) => Number(a.id !== view.parentId) - Number(b.id !== view.parentId))
        : data.sessions.filter((session) => (!view.projectId || session.projectId === view.projectId) &&
          (!view.favorites || session.pinned || this.favorites.has(session.id)) && (!view.chats || session.kind === "chat") &&
          (!view.attention || session.activity === "attention") && (!view.finished || this.finished(session.id)) && (!view.working || session.activity === "working") &&
          (flat || view.favorites || !nested(session)));
      items = rows.map((session) => {
        const count = view.parentId || flat ? 0 : children(session.id);
        return {
          ...viewTile(session.name, "session", count
            ? { type: "sessions", parentId: session.id, page: 0 }
            : { type: "session", id: session.id, page: 0 }),
          value: initials(session.name), activity: session.activity, flash: this.finished(session.id),
          accent: session.accent ?? data.projects.find((project) => project.id === session.projectId)?.accent,
          ...(count ? { children: count } : {}),
          ...(view.parentId && session.id !== view.parentId ? { nested: true } : {}),
        };
      });
    } else if (this.view.type === "session") {
      const id = this.sessionViewId(this.view);
      const session = data.sessions.find((row) => row.id === id);
      const own = id === data.bridgeSessionId;
      const appLive = !own && this.voice?.active?.id === id ? this.voice.active : undefined;
      const saved = !own && !appLive && this.savedDetails?.id === id ? this.savedDetails : undefined;
      const details = own ? data.details : appLive ?? saved;
      const missing = this.loadingDetails && !appLive ? "Loading" : own || saved || appLive ? "Unavailable" : "No bridge";
      const requested = this.openRequestedId === id;
      // Switching needs this session's own bridge; the app's companion API has no model control.
      const pickable = own && data.capabilities.model.available && !!data.models?.length;
      const efforts = pickable ? data.models!.find((model) => model.id === details?.model)?.efforts ?? [] : [];
      items = [
        { label: requested ? "Open requested" : "Open in app", icon: "open", disabled: requested || !data.capabilities.openSession.available || !session, action: { type: "command", command: { type: "openSession", id } } },
        { label: this.favorites.has(id) ? "Unfavorite" : "Favorite", icon: "star", selected: this.favorites.has(id), action: { type: "favorite", id } },
        { ...modelTile(details?.model), value: details?.model ?? missing, ...(details?.model ? {} : { tone: "muted" as Tone }),
          ...(pickable ? { action: { type: "view" as const, view: { type: "models" as const, page: 0, sessionId: id } } } : {}) },
        { label: details?.model === "auto" ? "Auto mode" : "Reasoning", value: details ? details.reasoning ?? "Default" : missing, tone: details ? "copilot" : "muted", disabled: !details,
          ...(efforts.length ? { action: { type: "view" as const, view: { type: "reasoning" as const, page: 0, sessionId: id } } } : {}) },
        { label: "Context used", value: details?.contextPercent === undefined ? missing : `${details.contextPercent.toFixed(0)}%`, gauge: details?.contextPercent, ring: this.easeRing(id, details?.contextPercent) },
        { label: "Context limit", value: details?.contextLimit === undefined ? missing : formatTokens(details.contextLimit), tone: details?.contextLimit === undefined ? "muted" : "blue" },
        { label: details?.creditsStatus === "complete" ? "AI credits" : details ? "Credits (partial)" : "AI credits", value: details?.aiCredits === undefined ? missing : details.aiCredits.toFixed(1), tone: details?.aiCredits === undefined ? "muted" : "gold" },
        viewTile("MCP servers", "server", { type: "mcp", page: 0, sessionId: id }, !this.appMcp(id) && (!own || !data.capabilities.mcp.available)),
        this.voiceTile(id),
        this.voice?.question && this.voice.activeSessionId === id
          ? this.questionTile({ label: "" })
          : session?.activity === "attention" && data.capabilities.openSession.available && !requested
            ? { label: "Needs you", icon: "session", activity: "attention", action: { type: "command", command: { type: "openSession", id } } }
            : { label: this.loadingDetails && !appLive ? "Loading details" : statusLabel(session?.activity) ?? (own ? "Session status" : appLive ? "Live from app" : saved ? "Saved values" : "Bridge not running"), icon: "session", activity: session?.activity ?? "unknown" },
      ];
    } else if (this.view.type === "models" || this.view.type === "reasoning") {
      const sessionId = this.view.sessionId;
      const current = data.bridgeSessionId === sessionId ? data.details : undefined;
      const models = data.bridgeSessionId === sessionId && data.capabilities.model.available ? data.models ?? [] : [];
      if (this.view.type === "models") {
        items = models.map((model): Tile => ({
          ...modelTile(model.id), ...(modelTile(model.id).provider ? {} : { label: model.name, value: model.name }),
          selected: model.id === current?.model,
          // Auto has no meaning without a mode, so pick the mode first and then confirm.
          action: model.id === "auto" && model.efforts.length
            ? { type: "view", view: { type: "reasoning", page: 0, sessionId, modelId: "auto" } }
            : { type: "view", view: { type: "confirm", page: 0, sessionId,
              command: { type: "setModel", modelId: model.id }, label: `Switch to ${model.name}?` } },
        }));
      } else {
        const target = this.view.modelId ?? current?.model;
        const model = models.find((row) => row.id === target);
        const onModel = model?.id === current?.model;
        items = (model?.efforts ?? []).map((effort): Tile => ({
          label: effort[0]!.toUpperCase() + effort.slice(1), icon: model!.id === "auto" ? "copilot" : "sparkle",
          selected: onModel && effort === current?.reasoning,
          action: { type: "view", view: { type: "confirm", page: 0, sessionId,
            command: { type: "setModel", modelId: model!.id, reasoning: effort }, label: model!.id === "auto" ? `Auto: ${effort}?` : `Reasoning: ${effort}?` } },
        }));
      }
    } else if (this.view.type === "mcp") {
      const sessionId = this.view.sessionId;
      const app = this.appMcp(sessionId);
      items = app ? app.map((server): Tile => ({
        label: server.name, icon: "grid",
        value: server.enabled ? "ON" : "OFF", tone: server.enabled ? "green" : "muted",
        selected: server.enabled,
        disabled: !server.toggleable,
        action: { type: "view", view: { type: "confirm", page: 0,
          command: { type: "setMcp", name: server.name, enabled: !server.enabled },
          request: { type: "mcp.toggle", serverId: server.id }, sessionId,
          label: `${server.enabled ? "Disable" : "Enable"} ${server.name}?` } },
      })) : data.bridgeSessionId !== sessionId ? [] : data.mcp.map((server) => ({
        label: server.name, icon: "grid",
        value: server.enabled ? "ON" : "OFF", tone: server.enabled ? "green" : "muted",
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
        { label: this.view.label, icon: this.view.command.type === "setMcp" ? "grid" : this.view.command.type === "setModel" ? "copilot" : "plus" },
      ];
    }
    const maxPage = Math.max(0, Math.ceil(items.length / 10) - 1);
    this.view.page = Math.min(this.view.page, maxPage);
    items.slice(this.view.page * 10, this.view.page * 10 + 10).forEach((tile, index) => { tiles[index] = tile; });
    if (!items.length) tiles[0] = { label: "No items", icon: "chat", disabled: true };
    tiles[10] = { label: "Back", icon: "back", disabled: !this.history.length, action: { type: "back" } };
    if (maxPage > 0) tiles[11] = { label: "Previous", icon: "left", disabled: this.view.page === 0, action: { type: "previous" } };
    const title = viewTitles[this.view.type] + (maxPage > 0 ? ` ${this.view.page + 1}/${maxPage + 1}` : "");
    tiles[12] = { label: this.error ? "Error: see settings" : this.busy ? "Please wait" : title,
      icon: this.error ? "error" : "home", activity: this.error ? "error" : this.busy ? "working" : undefined, action: { type: "home" } };
    tiles[13] = { label: "Refresh", icon: "refresh", action: { type: "refresh" } };
    if (maxPage > 0) tiles[14] = { label: "Next", icon: "right", disabled: this.view.page >= maxPage, action: { type: "next" } };
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

export type Provider = "anthropic" | "openai" | "google" | "xai" | "microsoft" | "auto";

/** Model tile: a provider badge with a readable model name, e.g. "gpt-6-astra" becomes "GPT-6 Astra". */
export function modelTile(model: string | undefined): { label: string; provider?: Provider } {
  if (!model) return { label: "Model" };
  const auto = /^auto\s*(?:→|->)\s*(.+)$/i.exec(model.trim());
  const name = (auto ? auto[1]! : model).trim();
  const id = name.toLowerCase();
  const provider: Provider | undefined = /^claude\b/.test(id) ? "anthropic"
    : /^(gpt|o\d|codex)\b/.test(id) ? "openai"
      : /^gemini\b/.test(id) ? "google"
        : /^grok\b/.test(id) ? "xai"
          : /^mai\b/.test(id) ? "microsoft"
            : id === "auto" ? "auto" : undefined;
  if (!provider) return { label: "Model" };
  const words = name.split(/[\s-]+/).filter(Boolean)
    .map((word) => /^(gpt|mai)$/i.test(word) ? word.toUpperCase() : word[0]!.toUpperCase() + word.slice(1));
  // The badge already shows the provider, so "Claude" is dropped to keep the name short; GPT stays joined to its version.
  if (provider === "anthropic") words.shift();
  if (provider === "openai" && words[0] === "GPT" && words[1]) words.splice(0, 2, `GPT-${words[1]}`);
  const pretty = words.join(" ") || "Auto";
  return { label: auto ? `Auto: ${pretty}` : pretty, provider };
}

function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}K` : String(tokens);
}
