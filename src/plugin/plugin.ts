import streamDeck, {
  action, SingletonAction, type WillAppearEvent, type WillDisappearEvent,
  type KeyDownEvent, type KeyUpEvent, type KeyAction,
} from "@elgato/streamdeck";
import { BridgeClient } from "./client.js";
import { CompanionClient, withNavFeed } from "./companion.js";
import { Dashboard } from "./dashboard.js";
import { readSavedDetails } from "./history.js";
import { tileDataUrl } from "./render.js";
import { record, type Command, type Snapshot } from "../shared/protocol.js";

type Settings = { favorites?: string[]; reducedMotion?: boolean; bridgeSessionId?: string };

@action({ UUID: "com.haflidif.copilot.dashboard" })
class DashboardAction extends SingletonAction {
  private client = new BridgeClient();
  private companion = new CompanionClient(undefined, () => {
    let retarget = false;
    this.client.follow(this.companion.state?.activeSessionId);
    for (const board of this.boards.values()) {
      const before = board.targetSessionId;
      board.voice = this.companion.state;
      this.applyFeed(board);
      if (before !== board.targetSessionId) { board.loadingDetails = Boolean(board.targetSessionId); retarget = true; }
    }
    if (retarget) void this.refresh();
    void this.render().catch((error: unknown) => this.report(error));
  });
  private talking = new Map<string, Promise<boolean>>();
  private voiceQueue: Promise<void> = Promise.resolve();
  private boards = new Map<string, Dashboard>();
  private bridgeState = new WeakMap<Dashboard, { snapshot?: Snapshot; error?: string }>();
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

  /** Opens sessions through the app's companion API when it is on, otherwise through the bridge deep link. */
  private async execute(command: Command, board: Dashboard): Promise<void> {
    if (command.type === "openSession" && this.companion.state) {
      try {
        await this.companion.send({ type: "session.open", sessionId: command.id });
        return;
      } catch (error) {
        streamDeck.logger.warn(`Companion open failed, using deep link: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (command.type === "newChat") {
      let created: string | undefined;
      let done = false;
      if (this.companion.state?.activeSessionId) {
        try {
          created = await this.client.command(command, this.companion.state.activeSessionId);
          done = true;
        } catch (error) {
          if (!(error instanceof Error) || !/no longer running/.test(error.message)) throw error;
        }
      }
      if (!done) created = await this.client.command(command);
      if (created) void this.openCreated(created);
      return;
    }
    await this.client.command(command, command.type === "setMcp" ? board.targetSessionId : undefined);
  }

  /** Switches the app to a session the deck just created. A new chat can take several seconds before the app can open it. */
  private async openCreated(id: string): Promise<void> {
    for (let attempt = 0; attempt < 12; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 400 : 1000));
      try {
        if (this.companion.state) { await this.companion.send({ type: "session.open", sessionId: id }); return; }
        await this.client.command({ type: "openSession", id });
        return;
      } catch (error) {
        if (attempt === 11) streamDeck.logger.warn(`Could not open the new chat: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private board(deviceId: string): Dashboard {
    let board = this.boards.get(deviceId);
    if (!board) {
      const created: Dashboard = new Dashboard((command) => this.execute(command, created), async (favorites) => {
        const settings = { ...this.settings, favorites };
        await streamDeck.settings.setGlobalSettings(settings);
        this.applySettings(settings);
      }, (request) => this.companion.send(request));
      board = created;
      board.favorites = new Set(this.settings.favorites ?? []);
      board.voice = this.companion.state;
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
    if (board.isVoice(coordinates.row * 5 + coordinates.column)) {
      const started = this.toggleVoice(ev.action);
      if (board.voice?.mode === "push_to_talk") this.talking.set(ev.action.id, started);
      await started;
      return;
    }
    try {
      const previousTarget = board.targetSessionId;
      const press = board.press(coordinates.row * 5 + coordinates.column);
      if (previousTarget !== board.targetSessionId) board.loadingDetails = Boolean(board.targetSessionId);
      const [result] = await Promise.all([press, this.render()]);
      if (result === "refresh" || previousTarget !== board.targetSessionId) await this.refresh();
    } catch (error) {
      board.error = error instanceof Error ? error.message : String(error);
      streamDeck.logger.error(board.error);
      await ev.action.showAlert();
    }
    await this.render();
    await this.sendStatus();
  }

  override async onKeyUp(ev: KeyUpEvent): Promise<void> {
    const started = this.talking.get(ev.action.id);
    this.talking.delete(ev.action.id);
    if (started && await started) await this.toggleVoice(ev.action);
  }

  private toggleVoice(key: KeyAction): Promise<boolean> {
    const result = this.voiceQueue.then(async () => {
      try {
        await this.companion.toggleVoice();
        return true;
      } catch (error) {
        streamDeck.logger.error(`Voice: ${error instanceof Error ? error.message : String(error)}`);
        await key.showAlert();
        return false;
      }
    });
    this.voiceQueue = result.then(() => undefined);
    return result;
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
          this.bridgeState.delete(board);
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
      void this.companion.ensure();
      try {
        await Promise.all([...this.boards.values()].map(async (board) => {
          for (;;) {
            const target = board.targetSessionId;
            try {
              const snapshot = await this.client.snapshot(target);
              const saved = target && target !== snapshot.bridgeSessionId
                ? await readSavedDetails(target, snapshot.sessions.find((row) => row.id === target)?.name ?? "Session").catch((error: unknown) => {
                  streamDeck.logger.warn(`Saved session details: ${error instanceof Error ? error.message : String(error)}`);
                  return undefined;
                })
                : undefined;
              if (target !== board.targetSessionId) continue;
              this.bridgeState.set(board, { snapshot });
              board.savedDetails = saved;
            } catch (error) {
              if (target !== board.targetSessionId) continue;
              const message = error instanceof Error ? error.message : String(error);
              this.bridgeState.set(board, { error: message });
              if (!this.companion.feed) streamDeck.logger.error(message);
            }
            this.applyFeed(board);
            board.loadingDetails = false;
            return;
          }
        }));
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

  /** The app's navigation feed is the source of truth for projects and sessions; the bridge adds the rest. */
  private applyFeed(board: Dashboard): void {
    const state = this.bridgeState.get(board);
    if (!state) return;
    const feed = this.companion.feed;
    const snapshot = feed ? withNavFeed(state.snapshot, feed, this.companion.state?.activeSessionId) : state.snapshot;
    board.snapshot = snapshot;
    board.error = snapshot ? (snapshot.errors.length ? snapshot.errors.join("\n") : undefined) : state.error;
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
      const tiles = new Map([...this.boards].map(([id, board]) => {
        board.reducedMotion = this.settings.reducedMotion === true;
        return [id, board.tiles()];
      }));
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
      detailsMessage: board?.detailsMessage ?? "",
      projects: board?.snapshot?.projects.length ?? 0,
      sessions: board?.snapshot?.sessions.length ?? 0,
    });
  }
}

streamDeck.actions.registerAction(new DashboardAction());
await streamDeck.connect();
