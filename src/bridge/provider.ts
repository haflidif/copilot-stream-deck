import { decodeToolResult, deadline, openSessionLink, validateSessionLink, type JoinedSession } from "./app-tools.js";
import { finite, record, text, type AppSession, type Command, type McpServer, type Project, type Snapshot } from "../shared/protocol.js";

export function normalizeSessions(value: unknown): AppSession[] {
  const rows = record(value).sessions;
  if (!Array.isArray(rows)) throw new Error("App status response has no sessions array");
  // One odd row (a brand new chat has no name yet) must not take the whole list down.
  return rows.flatMap((value) => {
    const row = record(value);
    if (typeof row.id !== "string" || !row.id.trim()) return [];
    const activity = row.activity === undefined ? {} : record(row.activity);
    const inProject = typeof row.project_id === "string";
    return [{
      id: row.id,
      name: typeof row.name === "string" && row.name.trim() ? row.name : inProject ? "New session" : "New chat",
      projectId: inProject ? row.project_id as string : undefined,
      kind: inProject ? "session" as const : "chat" as const,
      activity: row.awaiting_user_input || row.awaiting_plan_approval ? "attention" as const
        : row.was_interrupted ? "error" as const
        : activity.status === "busy" ? "working" as const
        : activity.status === "idle" ? "idle" as const : "unknown" as const,
    }];
  });
}

export function normalizeProjects(value: unknown): Project[] {
  if (!Array.isArray(value)) throw new Error("App projects response is not an array");
  return value.map((value) => {
    const row = record(value);
    return { id: text(row.id, "project id"), name: text(row.name, "project name") };
  });
}

export class AppProvider {
  private last?: Snapshot;
  private pending?: Promise<Snapshot>;
  private names = new Set<string>();
  private projects?: { time: number; value: Project[] };
  private unsubscribe: () => void;

  constructor(private session: JoinedSession, private openLink = openSessionLink) {
    this.unsubscribe = session.on((event) => {
      if (["assistant.turn_start", "user.message", "session.idle", "session.error",
        "permission.requested", "user_input.requested", "session.model_change"].includes(event.type)) this.last = undefined;
    });
  }

  dispose(): void { this.unsubscribe(); }

  async snapshot(): Promise<Snapshot> {
    if (this.last && Date.now() - Date.parse(this.last.capturedAt) < 5000) return this.last;
    if (this.pending) return this.pending;
    this.pending = this.load().finally(() => { this.pending = undefined; });
    return this.pending;
  }

  private async appTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.names.has(name)) throw new Error(`Copilot host does not expose ${name}`);
    return decodeToolResult(await deadline(this.session.rpc.tools.execute({ name, arguments: args })));
  }

  private async load(): Promise<Snapshot> {
    const snapshot: Snapshot = {
      version: 1, capturedAt: new Date().toISOString(), bridgeSessionId: this.session.sessionId,
      projects: [], sessions: [], mcp: [], errors: [],
      capabilities: {
        projects: { available: false }, sessions: { available: false },
        openSession: { available: false }, newChat: { available: false },
        details: { available: false }, mcp: { available: false },
        voice: { available: false, reason: "No verified Copilot app voice-control API" },
        appPins: { available: false, reason: "No verified Copilot app pinned-chat API. Favorites are local to this plugin." },
      },
    };
    const attempt = async (name: "projects" | "sessions" | "details" | "mcp", run: () => Promise<void>) => {
      try {
        await run();
        snapshot.capabilities[name] = { available: true };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        snapshot.capabilities[name] = { available: false, reason };
        snapshot.errors.push(`${name}: ${reason}`);
      }
    };
    try {
      const meta = record(await deadline(this.session.rpc.tools.getCurrentMetadata()));
      if (!Array.isArray(meta.tools)) throw new Error("No tool metadata");
      this.names = new Set(meta.tools.map((tool) => text(record(tool).name, "tool name")));
    } catch (error) {
      this.names.clear();
      snapshot.errors.push(`App tools: ${error instanceof Error ? error.message : String(error)}`);
    }
    snapshot.capabilities.openSession = {
      available: this.names.has("list_sessions_and_chats"), reason: this.names.has("list_sessions_and_chats") ? undefined : "Host session links unavailable",
    };
    snapshot.capabilities.newChat = {
      available: this.names.has("create_session"), reason: this.names.has("create_session") ? undefined : "Host session creation tool unavailable",
    };
    await Promise.all([
      attempt("projects", async () => {
        if (!this.projects || Date.now() - this.projects.time > 60000) {
          this.projects = { value: normalizeProjects(await this.appTool("list_projects")), time: Date.now() };
        }
        snapshot.projects = this.projects.value;
      }),
      attempt("sessions", async () => { snapshot.sessions = normalizeSessions(await this.appTool("get_sessions_status")); }),
      attempt("details", async () => {
        const [model, usage, metadata, context] = await Promise.all([
          deadline(this.session.rpc.model.getCurrent()).then(record),
          deadline(this.session.rpc.usage.getMetrics()).then(record),
          deadline(this.session.rpc.metadata.snapshot()).then(record),
          deadline(this.session.rpc.metadata.contextInfo({ promptTokenLimit: 0, outputTokenLimit: 0 })).then(record),
        ]);
        const info = context.contextInfo ? record(context.contextInfo) : {};
        const limit = finite(info.limit);
        const tokens = finite(info.totalTokens);
        const nano = finite(usage.totalNanoAiu);
        snapshot.details = {
          id: this.session.sessionId, name: String(metadata.summary ?? metadata.initialName ?? "Attached session"),
          model: typeof model.modelId === "string" ? model.modelId : undefined,
          reasoning: typeof model.reasoningEffort === "string" ? model.reasoningEffort : undefined,
          contextTier: typeof model.contextTier === "string" ? model.contextTier : undefined,
          contextLimit: limit,
          contextPercent: limit && tokens !== undefined ? tokens / limit * 100 : undefined,
          aiCredits: nano !== undefined && nano >= 0 ? nano / 1e9 : undefined,
          creditsStatus: typeof usage.aiCreditsStatus === "string" ? usage.aiCreditsStatus : undefined,
        };
      }),
      attempt("mcp", async () => {
        const result = record(await deadline(this.session.rpc.mcp.listConfigured()));
        if (!Array.isArray(result.servers)) throw new Error("No MCP servers array");
        snapshot.mcp = result.servers.map((value): McpServer => {
          const row = record(value);
          if (typeof row.enabled !== "boolean") throw new Error("Invalid MCP enabled flag");
          return { name: text(row.name, "MCP name"), enabled: row.enabled, status: text(record(row.live).status, "MCP status") };
        });
      }),
    ]);
    const current = snapshot.sessions.find((row) => row.id === this.session.sessionId);
    if (current && snapshot.details) snapshot.details.name = current.name;
    snapshot.capturedAt = new Date().toISOString();
    this.last = snapshot;
    return snapshot;
  }

  async command(command: Command): Promise<string | undefined> {
    const snapshot = await this.snapshot();
    switch (command.type) {
      case "openSession": {
        if (!snapshot.sessions.some((row) => row.id === command.id)) throw new Error("Session is no longer available");
        if (!snapshot.capabilities.openSession.available) throw new Error("Opening sessions is unavailable");
        const catalog = await this.appTool("list_sessions_and_chats");
        if (!Array.isArray(catalog)) throw new Error("App session catalog is not an array");
        const row = catalog.map(record).find((item) => item.id === command.id);
        if (!row) throw new Error("Session is no longer available in the app catalog");
        await this.openLink(validateSessionLink(row.app_url, command.id));
        break;
      }
      case "newChat": {
        if (!snapshot.capabilities.newChat.available) throw new Error("New chat is unavailable");
        const result = await deadline(this.session.rpc.tools.execute({
          name: "create_session",
          arguments: { session_kind: "chat", coordinate_with_creator: false },
        }), 45000);
        assertToolSuccess(result);
        return createdSessionId(result);
      }
      case "setMcp":
        if (!snapshot.capabilities.mcp.available || !snapshot.mcp.some((row) => row.name === command.name)) {
          throw new Error("MCP server is no longer available");
        }
        await deadline(command.enabled
          ? this.session.rpc.mcp.enable({ serverName: command.name })
          : this.session.rpc.mcp.disable({ serverName: command.name }));
        break;
    }
    this.last = undefined;
  }
}

function assertToolSuccess(value: unknown): void {
  if (typeof value === "string") {
    if (!value.trim()) throw new Error("App command returned an empty result");
    return;
  }
  const obj = record(value);
  if (obj.resultType !== "success") throw new Error(String(obj.error ?? obj.textResultForLlm ?? "App command failed"));
}

/** Finds the new session id in a create_session result, preferring an explicit session_id field. */
export function createdSessionId(value: unknown): string | undefined {
  const obj = typeof value === "string" ? {} : record(value);
  const text = typeof value === "string" ? value
    : [JSON.stringify(obj.structuredContent ?? null), String(obj.textResultForLlm ?? "")].join("\n");
  const uuid = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
  return text.match(new RegExp(`session_id\\W{0,4}(${uuid})`))?.[1] ?? text.match(new RegExp(uuid))?.[0];
}
