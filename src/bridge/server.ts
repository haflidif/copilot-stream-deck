import { createServer, type IncomingMessage } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { bridgeDirectory, isProcessAlive } from "../shared/paths.js";
import { parseCommand, parseDescriptor, type BridgeDescriptor, type Command, type Snapshot } from "../shared/protocol.js";

export interface Provider {
  snapshot(): Promise<Snapshot>;
  command(command: Command): Promise<string | undefined | void>;
}

export async function startBridge(provider: Provider, sessionId: string, directory = bridgeDirectory()) {
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(sessionId)) throw new Error("Invalid bridge session identifier");
  const token = randomBytes(32).toString("hex");
  let commandPending = false;
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "application/json");
    response.setHeader("X-Content-Type-Options", "nosniff");
    const reply = (code: number, body: unknown) => { response.writeHead(code); response.end(JSON.stringify(body)); };
    const auth = request.headers.authorization ?? "";
    const expected = `Bearer ${token}`;
    const authBytes = Buffer.from(auth);
    const expectedBytes = Buffer.from(expected);
    if (request.headers.origin || request.headers.host !== `127.0.0.1:${descriptor.port}` ||
        authBytes.length !== expectedBytes.length || !timingSafeEqual(authBytes, expectedBytes)) {
      reply(403, { error: "Forbidden" });
      return;
    }
    try {
      if (request.method === "GET" && request.url === "/v1/snapshot") {
        reply(200, await provider.snapshot());
      } else if (request.method === "POST" && request.url === "/v1/command") {
        if (request.headers["content-type"] !== "application/json") { reply(415, { error: "JSON required" }); return; }
        if (commandPending) { reply(409, { error: "A command is already running" }); return; }
        commandPending = true;
        try {
          const command = parseCommand(JSON.parse(await body(request)));
          const created = await provider.command(command);
          reply(200, { ok: true, ...(created ? { sessionId: created } : {}) });
        } finally {
          commandPending = false;
        }
      } else {
        reply(404, { error: "Not found" });
      }
    } catch (error) {
      reply(500, { error: error instanceof Error ? error.message : String(error) });
    }
  });
  server.requestTimeout = 20000;
  server.headersTimeout = 10000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No local bridge address");
  const descriptor: BridgeDescriptor = { version: 1, sessionId, token, port: address.port, pid: process.pid };
  const path = join(directory, `${sessionId}.json`);
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await pruneStale(directory);
    await writeFile(path, JSON.stringify(descriptor), { mode: 0o600 });
  } catch (error) {
    server.close();
    throw error;
  }
  return {
    descriptor,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      const current = await readFile(path, "utf8").catch(() => "");
      if (current.includes(token)) await rm(path, { force: true });
    },
  };
}

async function pruneStale(directory: string): Promise<void> {
  for (const name of await readdir(directory)) {
    if (!/^[a-zA-Z0-9-]+\.json$/.test(name)) continue;
    const path = join(directory, name);
    try {
      const { pid } = parseDescriptor(JSON.parse(await readFile(path, "utf8")));
      if (isProcessAlive(pid)) continue;
    } catch {
      // Unreadable or malformed descriptors are left for the owner to rewrite.
      continue;
    }
    await rm(path, { force: true });
  }
}

async function body(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const value of request) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    size += chunk.length;
    if (size > 8192) throw new Error("Command body exceeds 8 KB");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
