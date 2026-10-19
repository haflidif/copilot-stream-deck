import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { CompanionClient, parsePendingQuestion, parseVoiceState } from "../src/plugin/companion.js";
import { Dashboard } from "../src/plugin/dashboard.js";
import { snapshot } from "./fixtures.js";

const token = "b".repeat(43);

test("pending questions are parsed strictly", () => {
  assert.deepEqual(parsePendingQuestion({ token: "q-1", choiceCount: 3, customInputAvailable: true, choiceLabelPrefixes: ["Blue", " Red ", 7] }),
    { token: "q-1", choices: ["Blue", "Red", "Choice 3"], custom: true });
  assert.equal(parsePendingQuestion({ token: "bad token", choiceCount: 1 }), undefined);
  assert.deepEqual(parsePendingQuestion({ token: "q", choiceCount: 999 })?.choices, []);
  const state = parseVoiceState({ type: "snapshot", voiceDictation: { available: true, recording: false, recordingMode: "toggle" },
    activeSession: { id: "attached", pendingQuestion: { token: "q", choiceCount: 1, choiceLabelPrefixes: ["Yes"] } } });
  assert.deepEqual(state?.question, { token: "q", choices: ["Yes"], custom: false });
});

test("question view answers through the companion API", async () => {
  const sent: unknown[] = [];
  const board = new Dashboard(async () => {}, async () => {}, async (request) => { sent.push(request); });
  board.snapshot = snapshot();
  assert.equal(board.tiles()[9]!.label, "Live sessions");
  board.voice = { available: true, recording: false, mode: "toggle", activeSessionId: "attached",
    question: { token: "q", choices: ["Blue", "Red"], custom: true } };
  assert.equal(board.tiles()[9]!.label, "Answer question");
  assert.equal(board.tiles()[9]!.activity, "attention");
  await board.press(9);
  assert.equal(board.view.type, "question");
  const tiles = board.tiles();
  assert.deepEqual(tiles.slice(0, 3).map((tile) => tile.label), ["Blue", "Red", "Type answer"]);
  await board.press(1);
  assert.deepEqual(sent, [{ type: "question.answer", sessionId: "attached", questionToken: "q", choiceIndex: 1 }]);
  assert.equal(board.view.type, "home");
  await board.press(9);
  await board.press(2);
  assert.deepEqual(sent[1], { type: "question.focus_custom", sessionId: "attached", questionToken: "q" });
  board.voice = { ...board.voice, question: undefined };
  board.view = { type: "question", page: 0 };
  assert.equal(board.tiles()[0]!.label, "No question waiting");
});

test("Needs you leads to the question: straight from home, or by opening the session first", async () => {
  const commands: unknown[] = [];
  const board = new Dashboard(async (command) => { commands.push(command); }, async () => {}, async () => {});
  board.snapshot = snapshot();
  board.view = { type: "session", id: "other", page: 0 };
  assert.equal(board.tiles()[9]!.label, "Needs you");
  await board.press(9);
  assert.deepEqual(commands, [{ type: "openSession", id: "other" }]);
  board.voice = { available: true, recording: false, mode: "toggle", activeSessionId: "other",
    question: { token: "q", choices: ["Yes", "No"], custom: false } };
  assert.equal(board.tiles()[9]!.label, "Answer question");
  await board.press(9);
  assert.equal(board.view.type, "question");
  board.view = { type: "home", page: 0 };
  await board.press(8);
  assert.equal(board.view.type, "question");
  board.view = { type: "home", page: 0 };
  board.voice = { ...board.voice, activeSessionId: "attached" };
  await board.press(8);
  assert.equal(board.view.type, "sessions");
});

test("companion client sends session actions and rejects non-executed acks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "companion-actions-"));
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0, path: "/v1/logitech/session-actions" });
  const requests: Record<string, unknown>[] = [];
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    server.on("connection", (socket) => socket.on("message", (data) => {
      const request = JSON.parse(data.toString()) as Record<string, unknown>;
      requests.push(request);
      socket.send(JSON.stringify({ type: `${request.type}.ack`, requestId: request.requestId, status: request.choiceIndex === 9 ? "unavailable" : "executed" }));
    }));
    const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/v1/logitech/session-actions`;
    await writeFile(join(dir, "logitech-session-actions-v1.json"), JSON.stringify({ schemaVersion: 1, websocketUrl: url, bearerToken: token }));
    const client = new CompanionClient(dir);
    await client.send({ type: "question.answer", sessionId: "s", questionToken: "q", choiceIndex: 0 });
    await assert.rejects(client.send({ type: "question.answer", sessionId: "s", questionToken: "q", choiceIndex: 9 }), /unavailable/);
    assert.deepEqual(Object.keys(requests[0]!).sort(), ["choiceIndex", "questionToken", "requestId", "sessionId", "type"]);
    client.close();
  } finally {
    server.clients.forEach((socket) => socket.terminate());
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("active session view follows the session open in the app window", () => {
  const board = new Dashboard(async () => {}, async () => {});
  board.snapshot = snapshot();
  assert.equal(board.tiles()[6]!.label, "This session");
  board.view = { type: "session", id: "attached", follow: true, page: 0 };
  assert.equal(board.targetSessionId, "attached");
  board.voice = { available: true, recording: false, mode: "toggle", activeSessionId: "other" };
  assert.equal(board.targetSessionId, "other");
  board.view = { type: "home", page: 0 };
  assert.equal(board.tiles()[6]!.label, "Active session");
  board.view = { type: "session", id: "attached", page: 0 };
  assert.equal(board.targetSessionId, "attached");
});

test("new session goes through the companion API after a confirm step", async () => {
  const sent: unknown[] = [];
  const commands: unknown[] = [];
  const board = new Dashboard(async (command) => { commands.push(command); }, async () => {}, async (request) => { sent.push(request); });
  board.snapshot = snapshot();
  board.voice = { available: true, recording: false, mode: "toggle", activeSessionId: "attached" };
  assert.equal(board.tiles()[0]!.label, "New");
  await board.press(0);
  assert.equal(board.view.type, "confirm");
  assert.deepEqual(board.tiles().slice(0, 3).map((tile) => tile.label), ["In this project", "New chat", "Cancel"]);
  assert.deepEqual(sent, []);
  await board.press(0);
  assert.deepEqual(sent, [{ type: "session.new" }]);
  assert.equal(board.view.type as string, "home");
  await board.press(0);
  await board.press(1);
  assert.deepEqual(commands, [{ type: "newChat" }]);
  assert.equal(board.view.type as string, "home");
  board.voice = undefined;
  await board.press(0);
  assert.equal(board.view.type as string, "confirm");
  assert.equal(board.tiles()[0]!.label, "Confirm");
  assert.deepEqual(commands, [{ type: "newChat" }]);
});

test("created session id is read from create_session results", async () => {
  const { createdSessionId } = await import("../src/bridge/provider.js");
  const id = "12345678-1234-1234-1234-123456789abc";
  assert.equal(createdSessionId({ resultType: "success", textResultForLlm: `Created chat. session_id: ${id}` }), id);
  assert.equal(createdSessionId({ resultType: "success", structuredContent: { session_id: id, creator: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" } }), id);
  assert.equal(createdSessionId("Created chat"), undefined);
});
