import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { bridgeDirectory } from "../shared/paths.js";
import { parseDescriptor, parseSnapshot, record, type BridgeDescriptor, type Command, type Snapshot } from "../shared/protocol.js";

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export class BridgeClient {
  private descriptor?: BridgeDescriptor;
  private preferredId = "";

  select(sessionId: string): void {
    if (sessionId !== this.preferredId) {
      this.preferredId = sessionId;
      this.descriptor = undefined;
    }
  }

  private async discover(): Promise<BridgeDescriptor> {
    const directory = bridgeDirectory();
    let names: string[];
    try {
      names = await readdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("No Copilot bridge. Build this project and load its extension in the Copilot app.");
      throw error;
    }
    const paths = names.filter((name) => /^[a-zA-Z0-9-]+\.json$/.test(name) &&
      (!this.preferredId || name === `${this.preferredId}.json`)).map((name) => join(directory, name));
    const entries = await Promise.all(paths.map(async (path) => ({ path, modified: (await stat(path)).mtimeMs })));
    entries.sort((a, b) => b.modified - a.modified);
    for (const entry of entries) {
      let descriptor: BridgeDescriptor;
      try {
        descriptor = parseDescriptor(JSON.parse(await readFile(entry.path, "utf8")));
      } catch {
        continue;
      }
      if (isAlive(descriptor.pid)) return descriptor;
    }
    throw new Error("No matching Copilot bridge is running");
  }

  private async request(path: string, command?: Command): Promise<unknown> {
    const descriptor = this.descriptor ?? await this.discover();
    this.descriptor = descriptor;
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

  async snapshot(): Promise<Snapshot> {
    return parseSnapshot(await this.request("snapshot"));
  }

  async command(command: Command): Promise<void> {
    const result = record(await this.request("command", command));
    if (result.ok !== true) throw new Error("Copilot did not acknowledge the command");
  }
}
