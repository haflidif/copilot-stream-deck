import streamDeck, {
  action, SingletonAction, type WillAppearEvent, type WillDisappearEvent,
  type KeyDownEvent, type KeyAction,
} from "@elgato/streamdeck";
import { BridgeClient } from "./client.js";
import { Dashboard } from "./dashboard.js";
import { tileDataUrl } from "./render.js";
import { record } from "../shared/protocol.js";

type Settings = { favorites?: string[]; reducedMotion?: boolean; bridgeSessionId?: string };

@action({ UUID: "com.haflidif.copilot.dashboard" })
class DashboardAction extends SingletonAction {
  private client = new BridgeClient();
  private boards = new Map<string, Dashboard>();
  private visible = new Map<string, KeyAction>();
  private images = new Map<string, string>();
  private timer?: ReturnType<typeof setInterval>;
  private frame = 0;
  private rendering = false;
  private refreshing?: Promise<void>;
  private lastRefresh = 0;
  private settings: Settings = {};
  private settingsReady = streamDeck.settings.getGlobalSettings<Settings>().then((settings) => this.applySettings(settings));

  private applySettings(settings: Settings): void {
    this.settings = settings;
    this.client.select(settings.bridgeSessionId ?? "");
    for (const board of this.boards.values()) board.favorites = new Set(settings.favorites ?? []);
  }

  private board(deviceId: string): Dashboard {
    let board = this.boards.get(deviceId);
    if (!board) {
      board = new Dashboard((command) => this.client.command(command), async (favorites) => {
        const settings = { ...this.settings, favorites };
        await streamDeck.settings.setGlobalSettings(settings);
        this.applySettings(settings);
      });
      board.favorites = new Set(this.settings.favorites ?? []);
      const other = this.boards.values().next().value;
      if (other) { board.snapshot = other.snapshot; board.error = other.error; }
      this.boards.set(deviceId, board);
    }
    return board;
  }

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    if (!ev.action.isKey()) return;
    await this.settingsReady;
    this.visible.set(ev.action.id, ev.action);
    this.board(ev.action.device.id);
    await ev.action.setTitle("");
    if (!this.timer) this.timer = setInterval(() => {
      void this.tick().catch((error: unknown) => this.report(error));
    }, 125);
    await this.refresh();
    await this.render();
  }

  override onWillDisappear(ev: WillDisappearEvent): void {
    this.visible.delete(ev.action.id);
    this.images.delete(ev.action.id);
    if (!this.visible.size && this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const coordinates = ev.action.coordinates;
    if (!coordinates || ev.action.device.size.columns !== 5 || ev.action.device.size.rows !== 3) {
      await ev.action.showAlert();
      return;
    }
    const board = this.board(ev.action.device.id);
    try {
      const [result] = await Promise.all([
        board.press(coordinates.row * 5 + coordinates.column),
        this.render(),
      ]);
      if (result === "refresh") await this.refresh();
    } catch (error) {
      board.error = error instanceof Error ? error.message : String(error);
      streamDeck.logger.error(board.error);
      await ev.action.showAlert();
    }
    await this.render();
    await this.sendStatus();
  }

  override async onSendToPlugin(ev: Parameters<NonNullable<SingletonAction["onSendToPlugin"]>>[0]): Promise<void> {
    try {
      const message = record(ev.payload);
      if (message.type === "save") {
        if (typeof message.reducedMotion !== "boolean" || typeof message.bridgeSessionId !== "string" ||
            !/^[a-zA-Z0-9-]{0,100}$/.test(message.bridgeSessionId)) throw new Error("Invalid plugin settings");
        const settings = { ...this.settings, reducedMotion: message.reducedMotion, bridgeSessionId: message.bridgeSessionId };
        await streamDeck.settings.setGlobalSettings(settings);
        this.applySettings(settings);
        for (const board of this.boards.values()) {
          board.snapshot = undefined;
          board.view = { type: "home", page: 0 };
        }
      }
      await this.refresh();
      await this.sendStatus();
    } catch (error) {
      this.report(error);
      await this.sendStatus();
    }
  }

  private async tick(): Promise<void> {
    if (Date.now() - this.lastRefresh > 5000 && !this.refreshing) void this.refresh();
    this.frame = (this.frame + 1) % 12;
    await this.render();
  }

  private async refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const snapshot = await this.client.snapshot();
        for (const board of this.boards.values()) {
          board.snapshot = snapshot;
          board.error = snapshot.errors.length ? snapshot.errors.join("\n") : undefined;
        }
      } catch (error) {
        for (const board of this.boards.values()) board.snapshot = undefined;
        this.report(error);
      } finally {
        this.lastRefresh = Date.now();
        this.refreshing = undefined;
      }
    })();
    return this.refreshing;
  }

  private report(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    if (![...this.boards.values()].every((board) => board.error === message)) streamDeck.logger.error(message);
    for (const board of this.boards.values()) board.error = message;
  }

  private async render(): Promise<void> {
    if (this.rendering) return;
    this.rendering = true;
    try {
      const tiles = new Map([...this.boards].map(([id, board]) => [id, board.tiles()]));
      await Promise.all([...this.visible.values()].map(async (key) => {
        const pos = key.coordinates;
        const supported = key.device.size.columns === 5 && key.device.size.rows === 3;
        const tile = supported && pos ? tiles.get(key.device.id)?.[pos.row * 5 + pos.column] : undefined;
        const image = tileDataUrl(tile ?? { label: "Needs 15-key layout", icon: "error", activity: "error" }, this.frame, this.settings.reducedMotion === true);
        if (this.images.get(key.id) !== image) {
          await key.setImage(image);
          if (this.visible.has(key.id)) this.images.set(key.id, image);
        }
      }));
    } finally {
      this.rendering = false;
    }
  }

  private async sendStatus(): Promise<void> {
    const board = this.boards.values().next().value;
    await streamDeck.ui.sendToPropertyInspector({
      settings: this.settings,
      connected: Boolean(board?.snapshot),
      bridgeSessionId: board?.snapshot?.bridgeSessionId ?? "",
      attachedSession: board?.snapshot?.details?.name ?? "",
      error: board?.error ?? "",
      projects: board?.snapshot?.projects.length ?? 0,
      sessions: board?.snapshot?.sessions.length ?? 0,
    });
  }
}

streamDeck.actions.registerAction(new DashboardAction());
await streamDeck.connect();
