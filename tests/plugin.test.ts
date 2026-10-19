import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once, EventEmitter } from "node:events";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocketServer, type WebSocket } from "ws";
import { startBridge } from "../src/bridge/server.js";
import type { Command } from "../src/shared/protocol.js";
import { snapshot } from "./fixtures.js";

test("compiled plugin registers, renders 15 keys, navigates, animates and stops hidden keys", { timeout: 20000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "copilot-deck-plugin-test-"));
  const directory = join(root, "CopilotStreamDeck", "bridges");
  const commands: Command[] = [];
  const otherCommands: Command[] = [];
  const events = new EventEmitter();
  let otherHold: Promise<void> | undefined;
  let otherStarted = false;
  const otherBridge = await startBridge({
    snapshot: async () => {
      otherStarted = true;
      events.emit("message");
      await otherHold;
      const data = snapshot();
      data.bridgeSessionId = "other";
      data.details = { id: "other", name: "Other session", model: "other-model" };
      return data;
    },
    command: async (command) => { otherCommands.push(command); },
  }, "other", directory);
  const bridge = await startBridge({ snapshot: async () => snapshot(), command: async (command) => { commands.push(command); } }, "attached", directory);
  const exited = spawn(process.execPath, ["-e", ""]);
  await once(exited, "exit");
  await delay(20);
  await writeFile(join(directory, "stale.json"), JSON.stringify({ version: 1, sessionId: "stale", port: 1, token: "a".repeat(64), pid: exited.pid }));
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const plugin = join(root, "plugin");
  await cp(resolve("com.haflidif.copilot.sdPlugin"), plugin, { recursive: true });
  const info = {
    application: { version: "7.0.3", platform: "windows", platformVersion: "10", language: "en", font: "Segoe UI" },
    plugin: { uuid: "com.haflidif.copilot", version: "0.1.0.0" },
    devices: [{ id: "deck", name: "Test MK.2", type: 0, size: { columns: 5, rows: 3 } }],
    devicePixelRatio: 1, colors: {},
  };
  const messages: Record<string, unknown>[] = [];
  let output = "";
  const connected = new Promise<WebSocket>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Plugin did not connect")), 8000);
    server.once("connection", (socket) => { clearTimeout(timer); resolve(socket); });
  });
  const child = spawn(process.execPath, [
    join(plugin, "bin", "plugin.mjs"), "-port", String(address.port),
    "-pluginUUID", "test-plugin", "-registerEvent", "registerPlugin", "-info", JSON.stringify(info),
  ], { cwd: plugin, env: { ...process.env, LOCALAPPDATA: root, USERPROFILE: root, HOME: root }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (data: Buffer) => { output += data.toString(); });
  child.stderr.on("data", (data: Buffer) => { output += data.toString(); });
  function waitFor(check: () => boolean): Promise<void> {
    if (check()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error(`Plugin condition timed out. ${output}`)); }, 8000);
      const listener = () => { if (check()) { cleanup(); resolve(); } };
      function cleanup() { clearTimeout(timer); events.off("message", listener); }
      events.on("message", listener);
    });
  }
  // Labels can wrap over two <text> lines, so append the visible text joined by spaces.
  const images = (context: string): string[] => messages
    .filter((message) => message.event === "setImage" && message.context === context)
    .map((message) => {
      const payload = message.payload as { image: string };
      const svg = Buffer.from(payload.image.split(",")[1]!, "base64").toString("utf8");
      return `${svg}\n${[...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((match) => match[1]).join(" ")}`;
    });
  try {
    const socket = await connected;
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString()) as Record<string, unknown>;
      messages.push(message);
      if (message.event === "getGlobalSettings") {
        socket.send(JSON.stringify({ event: "didReceiveGlobalSettings", context: "test-plugin", payload: { settings: {} } }));
      }
      events.emit("message");
    });
    const send = (event: string, index: number) => socket.send(JSON.stringify({
      event, action: "com.haflidif.copilot.dashboard", context: `key-${index}`, device: "deck",
      payload: { controller: "Keypad", coordinates: { row: Math.floor(index / 5), column: index % 5 }, settings: {}, isInMultiAction: false },
    }));
    await waitFor(() => messages.some((message) => message.event === "registerPlugin"));
    for (let i = 0; i < 15; i++) send("willAppear", i);
    await waitFor(() => images("key-0").some((svg) => svg.includes("New chat")) && new Set(messages.filter((row) => row.event === "setImage").map((row) => row.context)).size === 15);
    send("keyDown", 2);
    await waitFor(() => images("key-0").some((svg) => svg.includes("Working session")));
    await waitFor(() => new Set(images("key-0").filter((svg) => svg.includes("Working session"))).size >= 2);
    send("keyDown", 0);
    await waitFor(() => images("key-2").some((svg) => svg.includes("auto")));
    send("keyDown", 0);
    await waitFor(() => commands.length === 1);
    assert.deepEqual(commands, [{ type: "openSession", id: "attached" }]);
    await waitFor(() => images("key-0").at(-1)?.includes("Open requested") === true);
    send("keyDown", 10);
    await waitFor(() => images("key-0").at(-1)?.includes("Working session") === true);
    let releaseOther!: () => void;
    otherHold = new Promise<void>((resolve) => { releaseOther = resolve; });
    send("keyDown", 1);
    await waitFor(() => otherStarted);
    send("keyDown", 10);
    await waitFor(() => images("key-0").at(-1)?.includes("Working session") === true);
    send("keyDown", 0);
    await waitFor(() => images("key-9").at(-1)?.includes("Loading details") === true);
    const releasedAt = Date.now();
    releaseOther();
    otherHold = undefined;
    await waitFor(() => images("key-9").at(-1)?.includes(">Working<") === true);
    assert.ok(Date.now() - releasedAt < 3000, "latest selection must refresh without waiting for the five-second poll");
    assert.match(images("key-2").at(-1)!, /auto/);
    send("keyDown", 10);
    await waitFor(() => images("key-0").at(-1)?.includes("Working session") === true);
    send("keyDown", 1);
    await waitFor(() => images("key-2").at(-1)?.includes("other-model") === true);
    send("keyDown", 7);
    await waitFor(() => images("key-0").at(-1)?.includes("example") === true);
    send("keyDown", 0);
    await waitFor(() => images("key-0").at(-1)?.includes("Confirm") === true);
    send("keyDown", 0);
    await waitFor(() => otherCommands.length === 1);
    assert.deepEqual(otherCommands, [{ type: "setMcp", name: "example", enabled: false }]);
    assert.equal(commands.length, 1);
    for (let i = 0; i < 15; i++) send("willDisappear", i);
    await delay(250);
    const count = messages.filter((row) => row.event === "setImage").length;
    await delay(400);
    assert.equal(messages.filter((row) => row.event === "setImage").length, count);
  } finally {
    child.kill();
    await once(child, "exit");
    for (const client of server.clients) client.terminate();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await bridge.close();
    await otherBridge.close();
    await rm(root, { recursive: true });
  }
});
