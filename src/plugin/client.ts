import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { bridgeDirectory, isProcessAlive } from "../shared/paths.js";
import { parseDescriptor, parseSnapshot, record, type BridgeDescriptor, type Command, type Snapshot } from "../shared/protocol.js";

export class BridgeClient {
  private descriptor?: BridgeDescriptor;
  private preferredId = "";

  constructor(private directory = bridgeDirectory()) {}

  select(sessionId: string): void {
    if (sessionId !== this.preferredId) {
      this.preferredId = sessionId;
      this.descriptor = undefined;
    }
  }

  private async discover(sessionId = this.preferredId): Promise<BridgeDescriptor | undefined> {
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
    const descriptor = target ?? this.descriptor ?? await this.discover();
    if (!descriptor) throw new Error("No matching Copilot bridge is running");
    if (!target) this.descriptor = descriptor;
    try {
      const response = await fetch(`http://127.0.0.1:${descriptor.port}/v1/${path}`, {
        method: command ? "POST" : "GET",
        headers: { Authorization: `Bearer ${descriptor.token}`, ...(command ? { "Content-Type": "application/json" } : {}) },
        body: command ? JSON.stringify(command) : undefined,
        signal: AbortSignal.timeout(18000),
        redirect: "error",
      });
      const data: unknown = await response.json();
      if (!response.ok) throw new Error(String(record(data).error ?? `Bridge returned ${response.status}`));
      return data;
    } catch (error) {
      this.descriptor = undefined;
      throw new Error(`Copilot bridge: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async snapshot(sessionId?: string): Promise<Snapshot> {
    return parseSnapshot(await this.request("snapshot", undefined, sessionId));
  }

  async command(command: Command, sessionId?: string): Promise<void> {
    const result = record(await this.request("command", command, sessionId));
    if (result.ok !== true) throw new Error("Copilot did not acknowledge the command");
  }
}
