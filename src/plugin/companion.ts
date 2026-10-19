import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import type { SessionDetails } from "../shared/protocol.js";

// Talks to the Copilot app's "Companion device integration" experiment (the same local
// API the Logitech keypad uses). It is undocumented, so every message is validated.

export interface Discovery { url: string; token: string }
export interface PendingQuestion { token: string; choices: string[]; custom: boolean }
export interface VoiceState {
  available: boolean; recording: boolean; mode: "toggle" | "push_to_talk"; activeSessionId?: string;
  active?: SessionDetails;
  question?: PendingQuestion;
}
export type CompanionRequest =
  | { type: "voice.toggle" }
  | { type: "session.open"; sessionId: string }
  | { type: "session.new" }
  | { type: "question.answer"; sessionId: string; questionToken: string; choiceIndex: number }
  | { type: "question.focus_custom"; sessionId: string; questionToken: string };
type ActionEndpoint = "voice-actions" | "session-actions" | "mcp-actions";
type Endpoint = "navigation" | ActionEndpoint;

function endpointFor(request: CompanionRequest): ActionEndpoint {
  return request.type === "voice.toggle" ? "voice-actions" : "session-actions";
}

export function parsePendingQuestion(value: unknown): PendingQuestion | undefined {
  if (!value || typeof value !== "object") return;
  const row = value as Record<string, unknown>;
  if (typeof row.token !== "string" || !/^[A-Za-z0-9-]{1,100}$/.test(row.token)) return;
  const total = typeof row.choiceCount === "number" && Number.isInteger(row.choiceCount) && row.choiceCount >= 0 && row.choiceCount <= 50 ? row.choiceCount : 0;
  const labels = Array.isArray(row.choiceLabelPrefixes) ? row.choiceLabelPrefixes : [];
  const choices = Array.from({ length: total }, (_, i) => {
    const text = labels[i];
    return typeof text === "string" && text.trim() ? [...text.trim()].slice(0, 60).join("") : `Choice ${i + 1}`;
  });
  return { token: row.token, choices, custom: row.customInputAvailable === true };
}

export function runDirectory(): string {
  return join(homedir(), ".copilot", "run");
}

export function parseDiscovery(text: string, endpoint: Endpoint): Discovery {
  const raw: unknown = JSON.parse(text);
  if (!raw || typeof raw !== "object") throw new Error("Invalid companion discovery file");
  const { schemaVersion, websocketUrl, bearerToken } = raw as Record<string, unknown>;
  if (schemaVersion !== 1) throw new Error("Unsupported companion discovery schema");
  if (typeof websocketUrl !== "string" || typeof bearerToken !== "string" || !/^[A-Za-z0-9_-]{20,200}$/.test(bearerToken)) {
    throw new Error("Invalid companion discovery file");
  }
  const url = new URL(websocketUrl);
  if (url.protocol !== "ws:" || url.hostname !== "127.0.0.1" || !url.port || url.pathname !== `/v1/logitech/${endpoint}` || url.search || url.username) {
    throw new Error("Companion endpoint must be a loopback WebSocket");
  }
  return { url: url.href, token: bearerToken };
}

export function parseVoiceState(message: unknown): VoiceState | undefined {
  if (!message || typeof message !== "object") return;
  const { type, voiceDictation, activeSession } = message as Record<string, unknown>;
  if (type !== "snapshot" || !voiceDictation || typeof voiceDictation !== "object") return;
  const voice = voiceDictation as Record<string, unknown>;
  if (typeof voice.available !== "boolean" || typeof voice.recording !== "boolean" ||
      (voice.recordingMode !== "toggle" && voice.recordingMode !== "push_to_talk")) return;
  const active = parseActiveSession(activeSession);
  const question = active ? parsePendingQuestion((activeSession as Record<string, unknown>).pendingQuestion) : undefined;
  return {
    available: voice.available, recording: voice.recording, mode: voice.recordingMode,
    activeSessionId: active?.id, ...(active ? { active } : {}), ...(question ? { question } : {}),
  };
}

const label = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() && value.length <= 100 ? value.trim() : undefined;
const count = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

export function parseActiveSession(value: unknown): SessionDetails | undefined {
  if (!value || typeof value !== "object") return;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(row.id)) return;
  const current = count(row.contextCurrentTokens);
  const limit = count(row.contextTokenLimit);
  const credits = label(row.aiCreditLabel)?.match(/^([\d,.]+)\s/)?.[1]?.replace(/,/g, "");
  const aiCredits = credits !== undefined && /^\d+(\.\d+)?$/.test(credits) ? Number(credits) : undefined;
  return {
    id: row.id, name: "Active session", source: "live",
    model: label(row.modelLabel),
    reasoning: label(row.reasoningEffortLabel) ?? label(row.reasoningEffort),
    contextPercent: current !== undefined && limit ? Math.min(100, current / limit * 100) : undefined,
    contextLimit: limit || undefined,
    contextTier: label(row.contextTierLabel) ?? label(row.contextTier),
    aiCredits, creditsStatus: aiCredits === undefined ? undefined : "complete",
  };
}

export class CompanionClient {
  state?: VoiceState;
  private navigation?: WebSocket;
  private sockets = new Map<ActionEndpoint, { socket: WebSocket; url: string }>();
  private pending = new Map<string, (status: string) => void>();
  private connecting = false;

  constructor(private directory = runDirectory(), private onChange: () => void = () => {}) {}

  private async discover(endpoint: Endpoint): Promise<Discovery> {
    return parseDiscovery(await readFile(join(this.directory, `logitech-${endpoint}-v1.json`), "utf8"), endpoint);
  }

  private open(found: Discovery): WebSocket {
    return new WebSocket(found.url, { headers: { Authorization: `Bearer ${found.token}` }, handshakeTimeout: 2000, maxPayload: 4 * 1024 * 1024 });
  }

  /** Keeps one read-only navigation connection for voice state. Safe to call often. */
  async ensure(): Promise<void> {
    if (this.connecting || (this.navigation && this.navigation.readyState <= WebSocket.OPEN)) return;
    this.connecting = true;
    try {
      const socket = this.open(await this.discover("navigation"));
      this.navigation = socket;
      socket.on("message", (data) => {
        try {
          const next = parseVoiceState(JSON.parse(data.toString()));
          if (next && JSON.stringify(next) !== JSON.stringify(this.state)) { this.state = next; this.onChange(); }
        } catch { /* ignore malformed frames */ }
      });
      socket.on("close", () => { if (this.navigation === socket) { this.navigation = undefined; this.state = undefined; this.onChange(); } });
      socket.on("error", () => socket.terminate());
    } catch {
      this.state = undefined;
    } finally {
      this.connecting = false;
    }
  }

  private async actionSocket(endpoint: ActionEndpoint): Promise<WebSocket> {
    const found = await this.discover(endpoint);
    const current = this.sockets.get(endpoint);
    if (current?.socket.readyState === WebSocket.OPEN && current.url === found.url) return current.socket;
    current?.socket.terminate();
    const socket = this.open(found);
    this.sockets.set(endpoint, { socket, url: found.url });
    socket.on("message", (data) => {
      try {
        const { type, requestId, status } = JSON.parse(data.toString()) as Record<string, unknown>;
        if (typeof type === "string" && type.endsWith(".ack") && typeof requestId === "string" && typeof status === "string") this.pending.get(requestId)?.(status);
      } catch { /* ignore malformed frames */ }
    });
    socket.on("error", () => socket.terminate());
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("close", () => reject(new Error("Copilot app closed the companion connection")));
    });
    return socket;
  }

  /** Sends one action to the app and waits for its acknowledgement. */
  async send(request: CompanionRequest): Promise<void> {
    const socket = await this.actionSocket(endpointFor(request));
    const requestId = randomUUID();
    const status = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error("Copilot app did not answer")); }, 5000);
      this.pending.set(requestId, (value) => { clearTimeout(timer); this.pending.delete(requestId); resolve(value); });
      socket.send(JSON.stringify({ ...request, requestId }));
    });
    if (status !== "executed") throw new Error(`${request.type}: ${status}`);
  }

  /** Starts or stops dictation in the app's active session. */
  toggleVoice(): Promise<void> {
    return this.send({ type: "voice.toggle" });
  }

  close(): void {
    this.navigation?.terminate();
    for (const { socket } of this.sockets.values()) socket.terminate();
  }
}
