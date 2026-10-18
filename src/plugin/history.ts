import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { finite, type SessionDetails } from "../shared/protocol.js";

const CHUNK = 256 * 1024;
const MAX_SCAN = 16 * 1024 * 1024;

export function sessionStateDirectory(): string {
  return join(homedir(), ".copilot", "session-state");
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

// Read-only fallback for sessions whose runtime (and bridge) is not loaded. Scans events.jsonl from the end.
export async function readSavedDetails(id: string, name: string, root = sessionStateDirectory()): Promise<SessionDetails | undefined> {
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw new Error("Invalid session id");
  let file;
  try {
    file = await open(join(root, id, "events.jsonl"), "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    const size = (await file.stat()).size;
    let position = size;
    let carry = Buffer.alloc(0);
    let usage: Record<string, unknown> | undefined;
    let modelChange: Record<string, unknown> | undefined;
    let credits: { nano?: number; status: string } | undefined;
    let updatedAt: string | undefined;
    const visit = (line: string): boolean => {
      if (!line.includes("\"type\":\"session.")) return false;
      let event: Record<string, unknown> | undefined;
      try { event = object(JSON.parse(line)); } catch { return false; }
      const data = object(event?.data);
      if (!event || !data) return false;
      if (!updatedAt && typeof event.timestamp === "string") updatedAt = event.timestamp;
      if (event.type === "session.usage_record" && !usage) usage = object(data.usage);
      else if (event.type === "session.model_change" && !usage && !modelChange) modelChange = data;
      else if (event.type === "session.shutdown" && !credits) {
        const accounting = object(data.accountingSnapshot);
        credits = { nano: finite(accounting?.totalNanoAiu), status: typeof accounting?.aiCreditsStatus === "string" ? accounting.aiCreditsStatus : "partial" };
      } else if (event.type === "session.usage_checkpoint" && !credits) credits = { nano: finite(data.totalNanoAiu), status: "partial" };
      return Boolean(usage && credits);
    };
    scan: while (position > 0 && size - position < MAX_SCAN) {
      const length = Math.min(CHUNK, position);
      position -= length;
      const chunk = Buffer.alloc(length);
      await file.read(chunk, 0, length, position);
      const buffer = Buffer.concat([chunk, carry]);
      let end = buffer.length;
      for (let index = buffer.lastIndexOf(10, end - 1); index >= 0; index = buffer.lastIndexOf(10, end - 1)) {
        if (visit(buffer.subarray(index + 1, end).toString("utf8").trim())) break scan;
        end = index;
        if (end === 0) break;
      }
      carry = buffer.subarray(0, end);
      if (position === 0 && visit(carry.toString("utf8").trim())) break;
    }
    if (!usage && !modelChange && !credits) return undefined;
    const input = finite(usage?.inputTokens);
    const limit = finite(usage?.maxPromptTokens);
    const model = typeof modelChange?.newModel === "string" ? modelChange.newModel
      : typeof usage?.model === "string" ? usage.model : undefined;
    return {
      id, name, source: "saved", updatedAt, model,
      reasoning: typeof modelChange?.reasoningEffort === "string" ? modelChange.reasoningEffort : undefined,
      contextTier: typeof modelChange?.contextTier === "string" ? modelChange.contextTier : undefined,
      contextLimit: limit,
      contextPercent: limit && input !== undefined ? input / limit * 100 : undefined,
      aiCredits: credits?.nano !== undefined && credits.nano >= 0 ? credits.nano / 1e9 : undefined,
      creditsStatus: credits?.status,
    };
  } finally {
    await file.close();
  }
}
