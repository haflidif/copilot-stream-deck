import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { bridgeDirectory, isProcessAlive } from "../shared/paths.js";
import { parseDescriptor, parseSnapshot, record, type BridgeDescriptor, type Command, type Snapshot } from "../shared/protocol.js";

class BridgeReplyError extends Error {}

export class BridgeClient {
  private descriptor?: BridgeDescriptor;
  private preferredId = "";
  private activeId = "";

  constructor(private directory = bridgeDirectory()) {}

  select(sessionId: string): void {
    if (sessionId !== this.preferredId) {
      this.preferredId = sessionId;
      this.descriptor = undefined;
    }
  }

  /** Soft preference for the app's active session. Hidden warmup sessions also start bridges, so newest is not always right. */
  follow(sessionId: string | undefined): void {
    const id = sessionId ?? "";
    if (id === this.activeId) return;
    this.activeId = id;
    if (!this.preferredId) this.descriptor = undefined;
  }

  private async discover(sessionId = this.preferredId): Promise<BridgeDescriptor | undefined> {
    if (!sessionId && this.activeId) {
      const active = await this.discover(this.activeId);
      if (active) return active;
    }
    const directory = this.directory;
    let names: string[];
    try {
      names = await readdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("No Copilot bridge. Build this project and load its extension in the Copilot app.");
      throw error;
    }
    const paths = names.filter((name) => /^[a-zA-Z0-9-]+\.json$/.test(name) &&
      (!sessionId || name === `${sessionId}.json`)).map((name) => join(directory, name));
    const entries = await Promise.all(paths.map(async (path) => ({ path, modified: (await stat(path)).mtimeMs })));
    entries.sort((a, b) => b.modified - a.modified);
    for (const entry of entries) {
      let descriptor: BridgeDescriptor;
      try {
        descriptor = parseDescriptor(JSON.parse(await readFile(entry.path, "utf8")));
      } catch {
        continue;
      }
      if (isProcessAlive(descriptor.pid)) return descriptor;
    }
    return undefined;
  }

  private async request(path: string, command?: Command, sessionId?: string): Promise<unknown> {
    const target = sessionId ? await this.discover(sessionId) : undefined;
    if (sessionId && command && !target) throw new Error("The selected session bridge is no longer running");
    const cached = !target && Boolean(this.descriptor);
    let descriptor = target ?? this.descriptor ?? await this.discover();
    if (!descriptor) throw new Error("No matching Copilot bridge is running");
    if (!target) this.descriptor = descriptor;
    for (let attempt = 0; ; attempt++) try {
      const response = await fetch(`http://127.0.0.1:${descriptor.port}/v1/${path}`, {
        method: command ? "POST" : "GET",
        headers: { Authorization: `Bearer ${descriptor.token}`, ...(command ? { "Content-Type": "application/json" } : {}) },
        body: command ? JSON.stringify(command) : undefined,
        signal: AbortSignal.timeout(command?.type === "newChat" ? 60000 : 18000),
        redirect: "error",
      });
      const data: unknown = await response.json();
      if (!response.ok) throw new BridgeReplyError(String(record(data).error ?? `Bridge returned ${response.status}`));
      return data;
    } catch (error) {
      this.descriptor = undefined;
      // A reloaded bridge comes back on a new port, so a cached one gets a single fresh lookup. Reads only, so commands never run twice.
      if (attempt === 0 && cached && !command && !(error instanceof BridgeReplyError)) {
        const fresh = await this.discover();
        if (fresh && (fresh.port !== descriptor.port || fresh.pid !== descriptor.pid)) {
          descriptor = this.descriptor = fresh;
          continue;
        }
      }
      throw new Error(`Copilot bridge: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async snapshot(sessionId?: string): Promise<Snapshot> {
    return parseSnapshot(await this.request("snapshot", undefined, sessionId));
  }

  /** Runs a command; returns the new session id when the bridge reports one. */
  async command(command: Command, sessionId?: string): Promise<string | undefined> {
    const result = record(await this.request("command", command, sessionId));
    if (result.ok !== true) throw new Error("Copilot did not acknowledge the command");
    return typeof result.sessionId === "string" && /^[a-zA-Z0-9-]{1,100}$/.test(result.sessionId) ? result.sessionId : undefined;
  }
}
