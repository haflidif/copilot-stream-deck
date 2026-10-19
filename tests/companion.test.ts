import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocketServer } from "ws";
import { CompanionClient, parseActiveSession, parseDiscovery, parseVoiceState } from "../src/plugin/companion.js";
import { Dashboard } from "../src/plugin/dashboard.js";
import { renderTile } from "../src/plugin/render.js";
import { snapshot } from "./fixtures.js";

const token = "a".repeat(43);
const discovery = (url: string) => JSON.stringify({ schemaVersion: 1, websocketUrl: url, bearerToken: token, instanceId: "x", pid: 1 });

test("companion discovery only accepts loopback WebSockets for the expected endpoint", () => {
  assert.equal(parseDiscovery(discovery("ws://127.0.0.1:5000/v1/logitech/voice-actions"), "voice-actions").url, "ws://127.0.0.1:5000/v1/logitech/voice-actions");
  for (const url of ["ws://example.com:5000/v1/logitech/voice-actions", "wss://127.0.0.1:5000/v1/logitech/voice-actions",
    "ws://127.0.0.1:5000/v1/logitech/navigation", "ws://127.0.0.1/v1/logitech/voice-actions"]) {
    assert.throws(() => parseDiscovery(discovery(url), "voice-actions"));
  }
  assert.throws(() => parseDiscovery(JSON.stringify({ schemaVersion: 1, websocketUrl: "ws://127.0.0.1:1/v1/logitech/navigation", bearerToken: "x y" }), "navigation"));
  assert.throws(() => parseDiscovery(JSON.stringify({ schemaVersion: 2, websocketUrl: "ws://127.0.0.1:1/v1/logitech/navigation", bearerToken: token }), "navigation"));
});

test("voice state is read from navigation snapshots", () => {
  assert.deepEqual(parseVoiceState({ type: "snapshot", voiceDictation: { available: true, recording: false, recordingMode: "push_to_talk" }, activeSession: { id: "attached" } }),
    { available: true, recording: false, mode: "push_to_talk", activeSessionId: "attached",
      active: { id: "attached", name: "Active session", source: "live", model: undefined, reasoning: undefined, contextPercent: undefined,
        contextLimit: undefined, contextTier: undefined, aiCredits: undefined, creditsStatus: undefined } });
  assert.equal(parseVoiceState({ type: "hello" }), undefined);
  assert.equal(parseVoiceState({ type: "snapshot", voiceDictation: { available: true, recording: "yes", recordingMode: "toggle" } }), undefined);
});

test("active session details are parsed from the app feed", () => {
  const details = parseActiveSession({ id: "other", modelLabel: "Auto → Claude Opus 5.5", reasoningEffort: "high", reasoningEffortLabel: "High",
    contextCurrentTokens: 82000, contextTokenLimit: 328000, contextTierLabel: "Long context", aiCreditLabel: "1,395 AI credits" });
  assert.equal(details?.model, "Auto → Claude Opus 5.5");
  assert.equal(details?.reasoning, "High");
  assert.equal(details?.contextPercent, 25);
  assert.equal(details?.contextLimit, 328000);
  assert.equal(details?.aiCredits, 1395);
  assert.equal(parseActiveSession({ id: "bad id!" }), undefined);
  assert.equal(parseActiveSession({ id: "x", contextCurrentTokens: -1, contextTokenLimit: 0, aiCreditLabel: "lots" })?.contextPercent, undefined);

  const board = new Dashboard(async () => {}, async () => {});
  board.snapshot = snapshot();
  board.view = { type: "session", id: "other", page: 0 };
  board.loadingDetails = true;
  board.voice = { available: true, recording: false, mode: "toggle", activeSessionId: "other", active: details };
  const tiles = board.tiles();
  assert.equal(tiles[2]!.value, "Auto → Claude Opus 5.5");
  assert.equal(tiles[4]!.gauge, 25);
  assert.equal(tiles[6]!.value, "1395.0");
  assert.equal(tiles[9]!.label, "Needs you");
  assert.equal(tiles[7]!.disabled, true);
  assert.match(board.detailsMessage ?? "", /Live values from the Copilot app/);
});

test("voice tile lives on the session view and follows the app's active session", () => {
  const board = new Dashboard(async () => {}, async () => {});
  board.snapshot = snapshot();
  assert.equal(board.tiles().some((row) => row.icon === "mic"), false);
  board.view = { type: "session", id: "attached", page: 0 };
  assert.equal(board.tiles()[8]!.label, "Voice: turn on");
  assert.equal(board.isVoice(8), false);
  board.voice = { available: true, recording: false, mode: "push_to_talk", activeSessionId: "attached" };
  assert.equal(board.tiles()[8]!.label, "Hold to talk");
  assert.equal(board.isVoice(8), true);
  board.voice = { ...board.voice, recording: true };
  assert.equal(board.tiles()[8]!.recording, true);
  assert.match(renderTile(board.tiles()[8]!, 3), /stroke="#ff747e" stroke-width="4"/);
  board.view = { type: "session", id: "other", page: 0 };
  assert.equal(board.tiles()[8]!.label, "Open to talk");
  assert.equal(board.isVoice(8), false);
  board.view = { type: "session", id: "attached", page: 0 };
  assert.equal(board.isVoice(8), true);
});

test("companion client sends authenticated voice toggles and tracks recording", async () => {
  const dir = await mkdtemp(join(tmpdir(), "companion-"));
  const servers: WebSocketServer[] = [];
  const auth: string[] = [];
  const requests: unknown[] = [];
  try {
    const listen = async (path: string, onConnect: (socket: import("ws").WebSocket) => void) => {
      const server = new WebSocketServer({ host: "127.0.0.1", port: 0, path });
      servers.push(server);
      server.on("connection", (socket, req) => { auth.push(req.headers.authorization ?? ""); onConnect(socket); });
      await new Promise((resolve) => server.once("listening", resolve));
      return `ws://127.0.0.1:${(server.address() as AddressInfo).port}${path}`;
    };
    let recording = false;
    const navigationSockets: import("ws").WebSocket[] = [];
    const publish = () => navigationSockets.forEach((socket) => socket.send(JSON.stringify({ type: "snapshot", voiceDictation: { available: true, recording, recordingMode: "push_to_talk" } })));
    await writeFile(join(dir, "logitech-navigation-v1.json"), discovery(await listen("/v1/logitech/navigation", (socket) => { navigationSockets.push(socket); publish(); })));
    await writeFile(join(dir, "logitech-voice-actions-v1.json"), discovery(await listen("/v1/logitech/voice-actions", (socket) => {
      socket.on("message", (data) => {
        const request = JSON.parse(data.toString()) as { requestId: string };
        requests.push(request);
        recording = !recording;
        socket.send(JSON.stringify({ type: "voice.toggle.ack", requestId: request.requestId, status: "executed" }));
        publish();
      });
    })));
    let changes = 0;
    const client = new CompanionClient(dir, () => changes++);
    await client.ensure();
    for (let i = 0; i < 50 && !client.state; i++) await delay(10);
    assert.deepEqual(client.state, { available: true, recording: false, mode: "push_to_talk", activeSessionId: undefined });
    await client.toggleVoice();
    for (let i = 0; i < 50 && !client.state?.recording; i++) await delay(10);
    assert.equal(client.state?.recording, true);
    await client.toggleVoice();
    assert.equal(requests.length, 2);
    assert.deepEqual(Object.keys(requests[0] as object).sort(), ["requestId", "type"]);
    assert.ok(auth.every((value) => value === `Bearer ${token}`));
    assert.ok(changes >= 2);
    client.close();
  } finally {
    servers.forEach((server) => { server.clients.forEach((socket) => socket.terminate()); server.close(); });
    await rm(dir, { recursive: true, force: true });
  }
});
