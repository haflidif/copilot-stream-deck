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

export interface Snapshot {
  version: 1;
  capturedAt: string;
  bridgeSessionId: string;
  projects: Project[];
  sessions: AppSession[];
  details?: SessionDetails;
  mcp: McpServer[];
  capabilities: Record<"projects" | "sessions" | "openSession" | "newChat" | "details" | "mcp" | "voice" | "appPins", Capability>;
  errors: string[];
}

export type Command =
  | { type: "openSession"; id: string }
  | { type: "newChat" }
  | { type: "setMcp"; name: string; enabled: boolean };

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
  const capability = (key: keyof Snapshot["capabilities"]): Capability => {
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
    errors: obj.errors.map((value) => text(value, "error")),
    capabilities: {
      projects: capability("projects"), sessions: capability("sessions"), openSession: capability("openSession"),
      newChat: capability("newChat"), details: capability("details"), mcp: capability("mcp"),
      voice: capability("voice"), appPins: capability("appPins"),
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
