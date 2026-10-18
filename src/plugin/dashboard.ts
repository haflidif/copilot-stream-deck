import type { Activity, Command, Snapshot } from "../shared/protocol.js";

export type Icon = "plus" | "folder" | "chat" | "star" | "grid" | "mic" | "back" | "home" | "left" | "right" | "refresh" | "open" | "check" | "error" | "session";
export interface Tile {
  label: string;
  icon?: Icon;
  value?: string;
  activity?: Activity;
  disabled?: boolean;
  selected?: boolean;
  action?: Action;
}
type View =
  | { type: "home"; page: number }
  | { type: "projects"; page: number }
  | { type: "sessions"; page: number; projectId?: string; favorites?: boolean; chats?: boolean }
  | { type: "session"; page: number; id: string }
  | { type: "mcp"; page: number }
  | { type: "confirm"; page: number; command: Command; label: string };
type Action =
  | { type: "view"; view: View }
  | { type: "back" | "previous" | "next" | "refresh" | "home" }
  | { type: "favorite"; id: string }
  | { type: "command"; command: Command };

export class Dashboard {
  view: View = { type: "home", page: 0 };
  private history: View[] = [];
  snapshot?: Snapshot;
  error?: string;
  busy = false;
  favorites = new Set<string>();

  constructor(private execute: (command: Command) => Promise<void>, private persist: (ids: string[]) => Promise<void>) {}

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
        viewTile("New chat", "plus", { type: "confirm", page: 0, command: { type: "newChat" }, label: "Create chat?" }, !data.capabilities.newChat.available),
        viewTile("Projects", "folder", { type: "projects", page: 0 }, !data.capabilities.projects.available),
        viewTile("Sessions", "chat", { type: "sessions", page: 0 }, !data.capabilities.sessions.available),
        viewTile("Favorites", "star", { type: "sessions", page: 0, favorites: true }, !data.capabilities.sessions.available),
        viewTile("MCP servers", "grid", { type: "mcp", page: 0 }, !data.capabilities.mcp.available),
        viewTile("Chats", "chat", { type: "sessions", page: 0, chats: true }, !data.capabilities.sessions.available),
        viewTile("This session", "session", { type: "session", id: data.bridgeSessionId, page: 0 }),
        unavailable("Voice: no API", "mic"),
        unavailable("App pins: no API", "star"),
        { label: "Live sessions", value: String(data.sessions.filter((row) => row.activity === "working").length) },
      ];
    } else if (this.view.type === "projects") {
      items = data.projects.map((project) => viewTile(project.name, "folder", { type: "sessions", projectId: project.id, page: 0 }));
    } else if (this.view.type === "sessions") {
      const view = this.view;
      items = data.sessions
        .filter((session) => (!view.projectId || session.projectId === view.projectId) &&
          (!view.favorites || this.favorites.has(session.id)) && (!view.chats || session.kind === "chat"))
        .map((session) => ({
          ...viewTile(session.name, "session", { type: "session", id: session.id, page: 0 }),
          value: initials(session.name), activity: session.activity,
        }));
    } else if (this.view.type === "session") {
      const id = this.view.id;
      const session = data.sessions.find((row) => row.id === id);
      const details = id === data.bridgeSessionId ? data.details : undefined;
      const own = id === data.bridgeSessionId;
      items = [
        { label: "Open in app", icon: "open", disabled: !data.capabilities.openSession.available || !session, action: { type: "command", command: { type: "openSession", id } } },
        { label: this.favorites.has(id) ? "Unfavorite" : "Favorite", icon: "star", selected: this.favorites.has(id), action: { type: "favorite", id } },
        { label: "Model", value: details?.model ?? "No data" },
        { label: "Reasoning", value: details ? details.reasoning ?? "Default" : "No data", disabled: !details },
        { label: "Context used", value: details?.contextPercent === undefined ? "No data" : `${details.contextPercent.toFixed(0)}%` },
        { label: "Context limit", value: details?.contextLimit === undefined ? "No data" : formatTokens(details.contextLimit) },
        { label: details?.creditsStatus === "complete" ? "AI credits" : "Credits (partial)", value: details?.aiCredits === undefined ? "No data" : details.aiCredits.toFixed(1) },
        viewTile("MCP servers", "grid", { type: "mcp", page: 0 }, !own || !data.capabilities.mcp.available),
        unavailable("Voice: no API", "mic"),
        { label: own ? "Attached here" : "Open app for details", icon: "session", activity: session?.activity ?? "unknown" },
      ];
    } else if (this.view.type === "mcp") {
      items = data.mcp.map((server) => ({
        label: server.name, icon: "grid",
        value: server.enabled ? "ON" : "OFF",
        selected: server.enabled,
        activity: server.status === "failed" ? "error" : undefined,
        action: { type: "view", view: { type: "confirm", page: 0,
          command: { type: "setMcp", name: server.name, enabled: !server.enabled },
          label: `${server.enabled ? "Disable" : "Enable"} ${server.name}?` } },
      }));
    } else if (this.view.type === "confirm") {
      items = [
        { label: "Confirm", icon: "check", action: { type: "command", command: this.view.command } },
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
    switch (action.type) {
      case "home": this.view = { type: "home", page: 0 }; this.history = []; break;
      case "back": this.view = this.history.pop() ?? { type: "home", page: 0 }; break;
      case "previous": this.view.page = Math.max(0, this.view.page - 1); break;
      case "next": this.view.page++; break;
      case "view": this.go(action.view); break;
      case "refresh": return "refresh";
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
