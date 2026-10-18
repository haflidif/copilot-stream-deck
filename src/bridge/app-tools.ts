import { readFile, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { record } from "../shared/protocol.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export function validateSessionLink(value: unknown, id: string): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(id) ||
      value !== `ghapp://sessions/${id}`) throw new Error("Invalid Copilot session link");
  return value;
}

export async function openSessionLink(url: string): Promise<void> {
  if (process.platform !== "win32") throw new Error("Opening Copilot session links requires Windows");
  await promisify(execFile)("rundll32.exe", ["url.dll,FileProtocolHandler", url], { timeout: 10000, windowsHide: true });
}

// Native tool responses may be spilled by the host's large-output processor.
export async function decodeToolResult(result: unknown): Promise<unknown> {
  let candidate: unknown = result;
  if (typeof result !== "string") {
    const obj = record(result);
    if (obj.resultType !== undefined && obj.resultType !== "success") {
      throw new Error(String(obj.error ?? obj.textResultForLlm ?? "App tool failed"));
    }
    if (obj.structuredContent !== undefined) return obj.structuredContent;
    candidate = obj.textResultForLlm;
  }
  if (typeof candidate !== "string") throw new Error("App tool returned no readable data");
  let content: string = candidate;
  const spill = content.match(/Saved to: ([^\r\n]+)/);
  if (spill?.[1]) {
    const path = resolve(spill[1].trim());
    if (dirname(path).toLowerCase() !== resolve(tmpdir()).toLowerCase() ||
        !/^.*copilot-tool-output-[\w-]+\.txt$/.test(basename(path))) {
      throw new Error("Rejected unexpected app tool spill path");
    }
    if ((await stat(path)).size > 4 * 1024 * 1024) throw new Error("App tool output exceeds 4 MB");
    content = await readFile(path, "utf8");
  }
  const start = content.search(/[\[{]/);
  if (start < 0) throw new Error("App tool returned no JSON data");
  try {
    return JSON.parse(content.slice(start));
  } catch {
    throw new Error("App tool returned invalid or truncated JSON");
  }
}

export interface JoinedSession {
  sessionId: string;
  on(handler: (event: { type: string; data: unknown }) => void): () => void;
  rpc: {
    tools: {
      getCurrentMetadata(): Promise<unknown>;
      execute(params: { name: string; arguments: Record<string, unknown> }): Promise<unknown>;
    };
    model: { getCurrent(): Promise<unknown> };
    metadata: { snapshot(): Promise<unknown>; contextInfo(params: { promptTokenLimit: number; outputTokenLimit: number }): Promise<unknown> };
    usage: { getMetrics(): Promise<unknown> };
    mcp: {
      listConfigured(): Promise<unknown>;
      enable(params: { serverName: string }): Promise<unknown>;
      disable(params: { serverName: string }): Promise<unknown>;
    };
  };
}

export function deadline<T>(promise: Promise<T>, ms = 12000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Copilot request timed out; outcome may be unknown")), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
