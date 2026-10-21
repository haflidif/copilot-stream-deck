export type Activity = "working" | "attention" | "ready" | "idle" | "error" | "unknown";

export interface Project {
  id: string;
  name: string;
  /** Project colour chosen in the Copilot app, such as "blue". */
  accent?: string;
}

export interface AppSession {
  id: string;
  name: string;
  projectId?: string;
  activity: Activity;
  kind: "session" | "chat";
  /** Pinned in the Copilot app sidebar. */
  pinned?: boolean;
  accent?: string;
  /** Session that created this one; the app nests it under that session in the sidebar. */
  parentId?: string;
}

export interface Capability {
  available: boolean;
  reason?: string;
}

export interface SessionDetails {
  id: string;
  name: string;
  model?: string;
  reasoning?: string;
  contextPercent?: number;
  contextLimit?: number;
  contextTier?: string;
  aiCredits?: number;
  creditsStatus?: string;
  source?: "live" | "saved";
  updatedAt?: string;
}

export interface McpServer {
  name: string;
  enabled: boolean;
  status: string;
}

export interface ModelOption {
  id: string;
  name: string;
  efforts: string[];
}

export type AgentStatus = "running" | "idle" | "completed" | "failed" | "cancelled";

export interface SessionAgent {
  id: string;
  name: string;
  agentType: string;
  status: AgentStatus;
  startedAt: string;
  completedAt?: string;
  activeTimeMs?: number;
  activeStartedAt?: string;
  model?: string;
  /** Squad member this task runs as, matched against the project's .squad/team.md. */
  member?: string;
  role?: string;
}

/** Whitelist display metadata only. Task prompts, responses and raw errors stay in the runtime. */
export function parseAgents(value: unknown): SessionAgent[] {
  if (!Array.isArray(value)) throw new Error("Invalid agents array");
  const ids = new Set<string>();
  return value.map((value) => {
    const row = record(value);
    const id = text(row.id, "agent id");
    if (ids.has(id)) throw new Error("Duplicate agent id");
    ids.add(id);
    if (!["running", "idle", "completed", "failed", "cancelled"].includes(String(row.status))) throw new Error("Invalid agent status");
    const time = (key: string, required = false): string | undefined => {
      if (row[key] === undefined && !required) return;
      if (typeof row[key] !== "string" || !Number.isFinite(Date.parse(row[key]))) throw new Error(`Invalid agent ${key}`);
      return row[key];
    };
    const activeTimeMs = finite(row.activeTimeMs);
    if (row.activeTimeMs !== undefined && (activeTimeMs === undefined || activeTimeMs < 0)) throw new Error("Invalid agent active time");
    return {
      id, name: text(row.name, "agent name"), agentType: text(row.agentType, "agent type"),
      status: row.status as AgentStatus, startedAt: time("startedAt", true)!,
      completedAt: time("completedAt"), activeStartedAt: time("activeStartedAt"), activeTimeMs,
      model: typeof row.model === "string" && row.model.trim() ? row.model : undefined,
      ...(short(row.member) ? { member: short(row.member) } : {}),
      ...(short(row.role) ? { role: short(row.role) } : {}),
    };
  });
}

const short = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() && value.length <= 40 ? value.trim() : undefined;

export interface Snapshot {
  version: 1;
  capturedAt: string;
  bridgeSessionId: string;
  projects: Project[];
  sessions: AppSession[];
  details?: SessionDetails;
  mcp: McpServer[];
  /** Models the session can switch to. Older bridges do not send it. */
  models?: ModelOption[];
  /** Runtime subagents belonging only to bridgeSessionId, never app-wide child sessions. */
  agents?: SessionAgent[];
  /** The session's working folder has a Squad team (.squad/team.md). */
  squad?: boolean;
  capabilities: Record<"projects" | "sessions" | "openSession" | "newChat" | "details" | "mcp" | "voice" | "appPins" | "model", Capability> & { agents?: Capability };
  errors: string[];
}

export type Command =
  | { type: "openSession"; id: string }
  | { type: "newChat" }
  | { type: "setMcp"; name: string; enabled: boolean }
  | { type: "setModel"; modelId: string; reasoning?: string };

export interface BridgeDescriptor {
  version: 1;
  sessionId: string;
  port: number;
  token: string;
  pid: number;
}

export function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected an object");
  }
  return value as Record<string, unknown>;
}

export function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Invalid ${field}`);
  return value;
}

export function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function parseCommand(value: unknown): Command {
  const obj = record(value);
  switch (obj.type) {
    case "openSession":
      return { type: "openSession", id: text(obj.id, "session id") };
    case "newChat":
      return { type: "newChat" };
    case "setMcp":
      if (typeof obj.enabled !== "boolean") throw new Error("Invalid MCP enabled state");
      return { type: "setMcp", name: text(obj.name, "MCP name"), enabled: obj.enabled };
    case "setModel":
      if (obj.reasoning !== undefined && typeof obj.reasoning !== "string") throw new Error("Invalid reasoning effort");
      return { type: "setModel", modelId: text(obj.modelId, "model id"), ...(obj.reasoning ? { reasoning: obj.reasoning } : {}) };
    default:
      throw new Error("Unsupported command");
  }
}

export function parseDescriptor(value: unknown): BridgeDescriptor {
  const obj = record(value);
  if (obj.version !== 1 || !Number.isInteger(obj.port) || Number(obj.port) < 1 || Number(obj.port) > 65535 ||
      typeof obj.token !== "string" || !/^[a-f0-9]{64}$/.test(obj.token) ||
      typeof obj.sessionId !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(obj.sessionId) ||
      !Number.isInteger(obj.pid) || Number(obj.pid) < 1) {
    throw new Error("Invalid local bridge descriptor");
  }

  return { version: 1, port: Number(obj.port), sessionId: obj.sessionId, token: obj.token, pid: Number(obj.pid) };
}

export function parseSnapshot(value: unknown): Snapshot {
  const obj = record(value);
  if (obj.version !== 1 || !Array.isArray(obj.projects) || !Array.isArray(obj.sessions) ||
      !Array.isArray(obj.mcp) || !Array.isArray(obj.errors)) throw new Error("Incompatible bridge response");
  const raw = record(obj.capabilities);
  if (raw.agents !== undefined && record(raw.agents).available === true && !Array.isArray(obj.agents)) {
    throw new Error("Agent capability has no task snapshot");
  }
  const capability = (key: keyof Snapshot["capabilities"]): Capability => {
    if ((key === "model" || key === "agents") && raw[key] === undefined) return { available: false, reason: "Bridge is out of date" };
    const value = record(raw[key]);
    if (typeof value.available !== "boolean") throw new Error(`Invalid ${key} capability`);
    return { available: value.available, reason: typeof value.reason === "string" ? value.reason : undefined };
  };
  const details = obj.details === undefined ? undefined : record(obj.details);
  return {
    version: 1,
    capturedAt: text(obj.capturedAt, "snapshot time"),
    bridgeSessionId: text(obj.bridgeSessionId, "bridge session"),
    projects: obj.projects.map((value) => {
      const row = record(value);
      return { id: text(row.id, "project id"), name: text(row.name, "project name") };
    }),
    sessions: obj.sessions.map((value) => {
      const row = record(value);
      if (row.kind !== "session" && row.kind !== "chat") throw new Error("Invalid session kind");
      if (row.activity !== "working" && row.activity !== "attention" && row.activity !== "ready" && row.activity !== "idle" &&
          row.activity !== "error" && row.activity !== "unknown") throw new Error("Invalid session activity");
      return {
        id: text(row.id, "session id"), name: text(row.name, "session name"), kind: row.kind, activity: row.activity,
        projectId: typeof row.projectId === "string" ? row.projectId : undefined,
        ...(typeof row.parentId === "string" && row.parentId ? { parentId: row.parentId } : {}),
      };
    }),
    mcp: obj.mcp.map((value) => {
      const row = record(value);
      if (typeof row.enabled !== "boolean") throw new Error("Invalid MCP state");
      return { name: text(row.name, "MCP name"), enabled: row.enabled, status: text(row.status, "MCP status") };
    }),
    ...(Array.isArray(obj.models) ? { models: obj.models.map((value) => {
      const row = record(value);
      return { id: text(row.id, "model id"), name: text(row.name, "model name"),
        efforts: Array.isArray(row.efforts) ? row.efforts.filter((effort): effort is string => typeof effort === "string" && !!effort) : [] };
    }) } : {}),
    ...(obj.agents === undefined ? {} : { agents: parseAgents(obj.agents) }),
    ...(obj.squad === true ? { squad: true } : {}),
    errors: obj.errors.map((value) => text(value, "error")),
    capabilities: {
      projects: capability("projects"), sessions: capability("sessions"), openSession: capability("openSession"),
      newChat: capability("newChat"), details: capability("details"), mcp: capability("mcp"),
      voice: capability("voice"), appPins: capability("appPins"), model: capability("model"), agents: capability("agents"),
    },
    details: details ? {
      id: text(details.id, "details id"), name: text(details.name, "details name"),
      model: typeof details.model === "string" ? details.model : undefined,
      reasoning: typeof details.reasoning === "string" ? details.reasoning : undefined,
      contextTier: typeof details.contextTier === "string" ? details.contextTier : undefined,
      creditsStatus: typeof details.creditsStatus === "string" ? details.creditsStatus : undefined,
      contextPercent: finite(details.contextPercent), contextLimit: finite(details.contextLimit), aiCredits: finite(details.aiCredits),
    } : undefined,
  };
}
