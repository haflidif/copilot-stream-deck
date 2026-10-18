import type { Snapshot } from "../src/shared/protocol.js";
import type { JoinedSession } from "../src/bridge/app-tools.js";

export function snapshot(): Snapshot {
  return {
    version: 1, capturedAt: new Date().toISOString(), bridgeSessionId: "attached",
    projects: [{ id: "p1", name: "Example project" }],
    sessions: [
      { id: "attached", name: "Working session", projectId: "p1", kind: "session", activity: "working" },
      { id: "other", name: "Other session", projectId: "p1", kind: "session", activity: "attention" },
      { id: "chat", name: "A chat", kind: "chat", activity: "idle" },
    ],
    details: { id: "attached", name: "Working session", model: "auto", contextPercent: 25, contextLimit: 200000, aiCredits: 2.5, creditsStatus: "complete" },
    mcp: [{ name: "example", enabled: true, status: "connected" }],
    capabilities: {
      projects: { available: true }, sessions: { available: true }, openSession: { available: true },
      newChat: { available: true }, details: { available: true }, mcp: { available: true },
      voice: { available: false, reason: "No API" }, appPins: { available: false, reason: "No API" },
    },
    errors: [],
  };
}

export function joinedSession(): JoinedSession {
  return {
    sessionId: "attached",
    on: () => () => {},
    rpc: {
      tools: {
        getCurrentMetadata: async () => ({ tools: ["list_projects", "get_sessions_status", "list_sessions_and_chats", "create_session"].map((name) => ({ name })) }),
        execute: async ({ name }) => ({
          resultType: "success",
          textResultForLlm: name === "list_projects" ? 'Found 1 project(s):\n[{"id":"p1","name":"Example"}]'
            : name === "get_sessions_status" ? JSON.stringify({ sessions: [
              { id: "attached", name: "Example session", project_id: "p1", activity: { status: "busy" } },
            ] }) : name === "list_sessions_and_chats" ? JSON.stringify([{ id: "attached", app_url: "ghapp://sessions/attached" }]) : "Done",
        }),
      },
      model: { getCurrent: async () => ({ modelId: "auto", reasoningEffort: "high", contextTier: "default" }) },
      metadata: {
        snapshot: async () => ({ summary: "Example session" }),
        contextInfo: async () => ({ contextInfo: { totalTokens: 50000, limit: 200000 } }),
      },
      usage: { getMetrics: async () => ({ totalNanoAiu: 2500000000, aiCreditsStatus: "complete" }) },
      mcp: {
        listConfigured: async () => ({ servers: [{ name: "example", enabled: true, live: { status: "connected" } }] }),
        enable: async () => {},
        disable: async () => {},
      },
    },
  };
}
