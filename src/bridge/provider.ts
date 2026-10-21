import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { decodeToolResult, deadline, openSessionLink, validateSessionLink, type JoinedSession } from "./app-tools.js";
import { finite, parseAgents, record, text, type AppSession, type Command, type McpServer, type ModelOption, type Project, type Snapshot } from "../shared/protocol.js";

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

/** Child sessions from the app catalog, keyed by id, with the session that created them. */
export function nestedSessions(catalog: unknown): Map<string, AppSession & { parentId: string }> {
  if (!Array.isArray(catalog)) throw new Error("App session catalog is not an array");
  const rows = catalog.flatMap((value) => value && typeof value === "object" && !Array.isArray(value) ? [value as Record<string, unknown>] : []);
  const ids = new Set(rows.map((row) => row.id));
  const children = new Map<string, AppSession & { parentId: string }>();
  for (const row of rows) {
    const parent = typeof row.coordinating_creator_session_id === "string" ? row.coordinating_creator_session_id
      : typeof row.creator_session_id === "string" ? row.creator_session_id : undefined;
    if (typeof row.id !== "string" || !parent || parent === row.id || !ids.has(parent)) continue;
    const inProject = typeof row.project_id === "string";
    children.set(row.id, {
      id: row.id, parentId: parent, activity: "unknown",
      name: typeof row.name === "string" && row.name.trim() ? row.name : inProject ? "New session" : "New chat",
      kind: row.type === "chat" || !inProject ? "chat" : "session",
      ...(inProject ? { projectId: row.project_id as string } : {}),
    });
  }
  return children;
}

export interface SquadMember { name: string; role: string }

/** Squad keeps its team in .squad/team.md; projects set up with older versions use .ai-team/team.md. Returns the roster, or undefined without a team. */
export async function readSquadTeam(folder: unknown): Promise<SquadMember[] | undefined> {
  if (typeof folder !== "string" || !isAbsolute(folder)) return;
  for (const dir of [".squad", ".ai-team"]) {
    let text: string;
    try {
      text = await readFile(join(folder, dir, "team.md"), "utf8");
    } catch { continue; }
    return parseSquadRoster(text);
  }
}

/** Reads every "| Name | Role | ..." table in team.md. Only names and roles leave this function. */
export function parseSquadRoster(markdown: string): SquadMember[] {
  const members: SquadMember[] = [];
  let inTable = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.trim().startsWith("|")) { inTable = false; continue; }
    const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.replace(/[*`]/g, "").trim());
    if (cells[0]?.toLowerCase() === "name" && cells[1]?.toLowerCase() === "role") { inTable = true; continue; }
    if (!inTable || cells.every((cell) => /^:?-*:?$/.test(cell))) continue;
    const [name, role] = cells;
    if (name && role && !name.startsWith("@") && name.length <= 40 && !members.some((row) => row.name.toLowerCase() === name.toLowerCase())) {
      members.push({ name, role: role.slice(0, 40) });
    }
  }
  return members;
}

/** Squad names each task after the member, like "neo" or "neo-impl", so match the whole name or a "neo-" style prefix. */
export function squadMember(agentName: string, roster: SquadMember[]): SquadMember | undefined {
  const key = agentName.trim().toLowerCase().replace(/^[^\p{L}\p{N}]+/u, "");
  return roster.filter((member) => {
    const name = member.name.toLowerCase();
    return key === name || (key.startsWith(name) && /^[-_ :]/.test(key.slice(name.length)));
  }).sort((a, b) => b.name.length - a.name.length)[0];
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
  private nested?: { time: number; value: Map<string, AppSession & { parentId: string }> };
  private models?: { time: number; value: ModelOption[] };
  private unsubscribe: () => void;
  private revision = 0;

  constructor(private session: JoinedSession, private openLink = openSessionLink) {
    this.unsubscribe = session.on((event) => {
      if (["assistant.turn_start", "user.message", "session.idle", "session.error",
        "permission.requested", "user_input.requested", "session.model_change", "session.background_tasks_changed",
        "subagent.started", "subagent.completed", "subagent.failed"].includes(event.type)) {
        this.last = undefined;
        this.revision++;
      }
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
    const revision = this.revision;
    const snapshot: Snapshot = {
      version: 1, capturedAt: new Date().toISOString(), bridgeSessionId: this.session.sessionId,
      projects: [], sessions: [], mcp: [], errors: [],
      capabilities: {
        projects: { available: false }, sessions: { available: false },
        openSession: { available: false }, newChat: { available: false },
        details: { available: false }, mcp: { available: false },
        voice: { available: false, reason: "No verified Copilot app voice-control API" },
        appPins: { available: false, reason: "No verified Copilot app pinned-chat API. Favorites are local to this plugin." },
        model: { available: false },
        agents: { available: false, reason: "This runtime does not expose agent tasks" },
      },
    };
    const attempt = async (name: "projects" | "sessions" | "details" | "mcp" | "model" | "agents", run: () => Promise<void>) => {
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
    let roster: SquadMember[] | undefined;
    await Promise.all([
      ...(this.session.rpc.tasks?.list ? [attempt("agents", async () => {
        const result = record(await deadline(this.session.rpc.tasks!.list()));
        if (!Array.isArray(result.tasks)) throw new Error("No agent tasks array");
        snapshot.agents = parseAgents(result.tasks.map(record).filter((row) => row.type === "agent").map((row) => ({
          id: row.id,
          name: typeof row.displayName === "string" && row.displayName.trim() ? row.displayName : row.agentType,
          agentType: row.agentType, status: row.status, startedAt: row.startedAt,
          completedAt: row.completedAt, activeTimeMs: row.activeTimeMs, activeStartedAt: row.activeStartedAt,
          model: row.resolvedModel ?? row.model,
        })));
      })] : []),
      attempt("projects", async () => {
        if (!this.projects || Date.now() - this.projects.time > 60000) {
          this.projects = { value: normalizeProjects(await this.appTool("list_projects")), time: Date.now() };
        }
        snapshot.projects = this.projects.value;
      }),
      attempt("sessions", async () => {
        const sessions = normalizeSessions(await this.appTool("get_sessions_status"));
        // Nesting rarely changes, so the catalog is read at most once a minute and a failure keeps the flat list.
        if (this.names.has("list_sessions_and_chats") && (!this.nested || Date.now() - this.nested.time > 60000)) {
          try {
            this.nested = { value: nestedSessions(await this.appTool("list_sessions_and_chats")), time: Date.now() };
          } catch (error) {
            snapshot.errors.push(`nesting: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        const nested = this.nested?.value ?? new Map();
        for (const row of sessions) {
          const parentId = nested.get(row.id)?.parentId;
          if (parentId) row.parentId = parentId;
        }
        const known = new Set(sessions.map((row) => row.id));
        for (const child of nested.values()) if (!known.has(child.id)) sessions.push({ ...child });
        snapshot.sessions = sessions;
      }),
      attempt("details", async () => {
        const [model, usage, metadata, context] = await Promise.all([
          deadline(this.session.rpc.model.getCurrent()).then(record),
          deadline(this.session.rpc.usage.getMetrics()).then(record),
          deadline(this.session.rpc.metadata.snapshot()).then(record),
          deadline(this.session.rpc.metadata.contextInfo({ promptTokenLimit: 0, outputTokenLimit: 0 })).then(record),
        ]);
        roster = await readSquadTeam(metadata.workingDirectory);
        if (roster) snapshot.squad = true;
        const info = context.contextInfo ? record(context.contextInfo) : {};
        const limit = finite(info.limit);
        const tokens = finite(info.totalTokens);
        const nano = finite(usage.totalNanoAiu);
        snapshot.details = {
          id: this.session.sessionId, name: String(metadata.summary ?? metadata.initialName ?? "Attached session"),
          model: typeof model.modelId === "string" ? model.modelId : undefined,
          reasoning: model.modelId === "auto" && typeof model.autoTier === "string" ? model.autoTier
            : typeof model.reasoningEffort === "string" ? model.reasoningEffort : undefined,
          contextTier: typeof model.contextTier === "string" ? model.contextTier : undefined,
          contextLimit: limit,
          contextPercent: limit && tokens !== undefined ? tokens / limit * 100 : undefined,
          aiCredits: nano !== undefined && nano >= 0 ? nano / 1e9 : undefined,
          creditsStatus: typeof usage.aiCreditsStatus === "string" ? usage.aiCreditsStatus : undefined,
        };
      }),
      attempt("model", async () => {
        if (!this.models || Date.now() - this.models.time > 300000) {
          this.models = { value: normalizeModels(await deadline(this.session.rpc.model.list())), time: Date.now() };
        }
        snapshot.models = this.models.value;
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
    if (roster?.length && snapshot.agents) {
      snapshot.agents = snapshot.agents.map((agent) => {
        const member = squadMember(agent.name, roster!);
        return member ? { ...agent, member: member.name, role: member.role } : agent;
      });
    }
    const current = snapshot.sessions.find((row) => row.id === this.session.sessionId);
    if (current && snapshot.details) snapshot.details.name = current.name;
    snapshot.capturedAt = new Date().toISOString();
    if (revision === this.revision) this.last = snapshot;
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
        this.nested = undefined;
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
      case "setModel": {
        const model = snapshot.models?.find((row) => row.id === command.modelId);
        if (!snapshot.capabilities.model.available || !model) throw new Error("Model is no longer available");
        if (command.reasoning && !model.efforts.includes(command.reasoning)) throw new Error(`${model.name} does not support ${command.reasoning}`);
        // For Auto the reasoning slot carries the Auto tier (efficiency, balance, intelligence).
        const result = record(await deadline(this.session.rpc.model.switchTo({
          modelId: command.modelId, source: "model_picker", deferIfModelChangeQueued: true,
          ...(command.reasoning ? command.modelId === "auto" ? { autoTier: command.reasoning } : { reasoningEffort: command.reasoning } : {}),
        })));
        // The runtime asks for confirmation when the conversation is larger than the new model's context.
        if (result.confirmation) throw new Error(`The conversation is too large for ${model.name}. Switch in the app instead.`);
        if (typeof result.status === "string" && /fail|reject|error|denied/i.test(result.status)) {
          throw new Error(typeof result.message === "string" ? result.message : `Model switch ${result.status}`);
        }
        break;
      }
    }
    this.last = undefined;
  }
}

/** Reads the session model catalog, skipping models that policy disables. Auto always comes first, with its tiers as options. */
export function normalizeModels(value: unknown): ModelOption[] {
  const catalog = record(value);
  const list = catalog.list;
  if (!Array.isArray(list)) throw new Error("No model list");
  const models = list.flatMap((item): ModelOption[] => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id || row.id === "auto") return [];
    const policy = row.policy && typeof row.policy === "object" ? (row.policy as Record<string, unknown>).state : undefined;
    if (policy === "disabled") return [];
    const efforts = Array.isArray(row.supportedReasoningEfforts)
      ? row.supportedReasoningEfforts.filter((effort): effort is string => typeof effort === "string" && !!effort) : [];
    return [{ id: row.id, name: typeof row.name === "string" && row.name ? row.name : row.id, efforts }];
  });
  const auto = catalog.auto && typeof catalog.auto === "object" ? (catalog.auto as Record<string, unknown>).tiers : undefined;
  const tiers = Array.isArray(auto) ? auto.flatMap((tier) => {
    const row = tier && typeof tier === "object" ? tier as Record<string, unknown> : {};
    const status = row.status && typeof row.status === "object" ? row.status as Record<string, unknown> : {};
    return typeof row.id === "string" && row.id && status.enabled !== false && (row.type === undefined || row.type === "auto") ? [row.id] : [];
  }) : [];
  return [{ id: "auto", name: "Auto", efforts: tiers.length ? tiers : ["efficiency", "balance", "intelligence"] }, ...models];
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
