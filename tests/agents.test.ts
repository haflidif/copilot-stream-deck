import { test } from "node:test";
import assert from "node:assert/strict";
import { AppProvider } from "../src/bridge/provider.js";
import { Dashboard } from "../src/plugin/dashboard.js";
import { renderTile } from "../src/plugin/render.js";
import { parseAgents, parseSnapshot, type SessionAgent } from "../src/shared/protocol.js";
import { joinedSession, snapshot } from "./fixtures.js";

const agent = (id = "a1", status: SessionAgent["status"] = "running"): SessionAgent => ({
  id, name: "Test agent", agentType: "task", status, startedAt: "2026-10-20T22:00:00Z",
});

test("agent parser rejects invalid snapshots and only carries display metadata", () => {
  const row = { ...agent(), prompt: "private prompt", result: "private output", error: "private error" };
  const parsed = parseAgents([row]);
  assert.equal(JSON.stringify(parsed).includes("private"), false);
  for (const patch of [{ status: "invented" }, { startedAt: "not a date" }, { activeTimeMs: -1 }, { id: "" }]) {
    assert.throws(() => parseAgents([{ ...row, ...patch }]), /Invalid/);
  }
  assert.throws(() => parseAgents([row, row]), /Duplicate/);
  const old = parseSnapshot(snapshot());
  assert.equal(old.capabilities.agents?.available, false);
  const data = snapshot();
  data.capabilities.agents = { available: true };
  assert.throws(() => parseSnapshot(data), /no task snapshot/);
  data.agents = [agent()];
  assert.equal(parseSnapshot(data).agents?.[0]?.id, "a1");
});

test("provider whitelists agent tasks, invalidates on changes and recovers after reconnect", async () => {
  const session = joinedSession();
  const handlers = new Set<(event: { type: string; data: unknown }) => void>();
  const notify = (event: { type: string; data: unknown }) => { for (const handler of handlers) handler(event); };
  session.on = (handler) => { handlers.add(handler); return () => { handlers.delete(handler); }; };
  let status = "running";
  let calls = 0;
  session.rpc.tasks = { list: async () => {
    calls++;
    return { tasks: [
      { ...agent(), displayName: "Deck tester", type: "agent", status, model: "requested", resolvedModel: "resolved",
        prompt: "private", latestResponse: "private", error: "private" },
      { type: "shell", id: "shell" }, { type: "client", id: "client" },
    ] };
  } };
  const provider = new AppProvider(session);
  try {
    const first = await provider.snapshot();
    assert.equal(first.capabilities.agents?.available, true);
    assert.equal(first.agents?.length, 1);
    assert.equal(first.agents?.[0]?.name, "Deck tester");
    assert.equal(first.agents?.[0]?.model, "resolved");
    assert.equal(JSON.stringify(first.agents).includes("private"), false);
    await provider.snapshot();
    assert.equal(calls, 1);
    status = "idle";
    notify({ type: "subagent.completed", data: {} });
    const after = await provider.snapshot();
    assert.equal(after.agents?.[0]?.status, "idle", "A completed turn is not a completed multi-turn task");
    status = "running";
    for (let i = 0; i < 10; i++) notify({ type: "session.background_tasks_changed", data: {} });
    await Promise.all([provider.snapshot(), provider.snapshot()]);
    assert.equal(calls, 3, "Burst notifications share one snapshot load");
    const reconnected = new AppProvider(session);
    try { assert.equal((await reconnected.snapshot()).agents?.[0]?.status, "running"); }
    finally { reconnected.dispose(); }
    session.rpc.tasks.list = async () => { throw new Error("Task endpoint unavailable"); };
    notify({ type: "session.background_tasks_changed", data: {} });
    const failed = await provider.snapshot();
    assert.equal(failed.capabilities.agents?.available, false);
    assert.equal(failed.agents, undefined);
    assert.ok(failed.errors.some((line) => line === "agents: Task endpoint unavailable"));
  } finally { provider.dispose(); }
});

test("older runtimes explicitly disable agents without breaking other capabilities", async () => {
  const provider = new AppProvider(joinedSession());
  try {
    const data = await provider.snapshot();
    assert.equal(data.capabilities.agents?.available, false);
    assert.match(data.capabilities.agents?.reason ?? "", /runtime/);
    assert.equal(data.capabilities.details.available, true);
    assert.equal(data.errors.length, 0);
  } finally { provider.dispose(); }
});

test("agent events during a load do not leave the snapshot cached", async () => {
  const session = joinedSession();
  let notify: (event: { type: string; data: unknown }) => void = () => {};
  session.on = (handler) => { notify = handler; return () => {}; };
  let calls = 0;
  session.rpc.tasks = { list: async () => {
    calls++;
    if (calls === 1) notify({ type: "session.background_tasks_changed", data: {} });
    return { tasks: [] };
  } };
  const provider = new AppProvider(session);
  try {
    await provider.snapshot();
    await provider.snapshot();
    assert.equal(calls, 2);
  } finally { provider.dispose(); }
});

function boardWithAgents() {
  const board = new Dashboard(async () => { throw new Error("Agents must be read-only"); }, async () => {});
  board.snapshot = { ...snapshot(), agents: [agent()], capabilities: { ...snapshot().capabilities, agents: { available: true } } };
  return board;
}

test("session keeps all controls, puts Agents on the spare Previous key and routes details by task id", async () => {
  const board = boardWithAgents();
  await board.press(6);
  assert.equal(board.tiles()[8]?.label, "Voice: turn on");
  assert.equal(board.tiles()[1]?.label, "Favorite");
  assert.equal(board.tiles()[11]?.label, "Agents");
  assert.equal(board.tiles()[11]?.icon, "agent");
  assert.equal(board.tiles()[11]?.count, 1);
  assert.equal(board.tiles()[11]?.value, undefined);
  assert.equal(board.tiles()[11]?.breathe, board.snapshot!.agents![0]!.status === "running");
  assert.match(renderTile(board.tiles()[11]!), />1<\/text>/);
  assert.equal(board.tiles()[14]?.label, "");
  assert.doesNotMatch(board.tiles()[12]?.label ?? "", /\//);
  await board.press(11);
  assert.equal(String(board.view.type), "agents");
  assert.equal(board.targetSessionId, "attached");
  assert.equal(board.tiles()[0]?.activity, "working");
  const row = board.tiles()[0]!;
  assert.notEqual(renderTile(row, 0, false), renderTile(row, 4, false));
  assert.equal(renderTile(row, 0, true), renderTile(row, 4, true));
  await board.press(0);
  assert.equal(String(board.view.type), "agent");
  assert.equal(board.targetSessionId, "attached");
  assert.equal(board.tiles()[1]?.label, "Working");
  await board.press(10);
  assert.equal(String(board.view.type), "agents");
  await board.press(10);
  assert.equal(String(board.view.type), "session");
  assert.equal(board.view.page, 0);
});

test("lists of up to 12 use the spare arrow keys, and 13 or more page by 10", () => {
  const board = boardWithAgents();
  board.view = { type: "agents", page: 0, sessionId: "attached" };
  board.snapshot!.agents = Array.from({ length: 12 }, (_, i) => agent(`a${String(i).padStart(2, "0")}`));
  let tiles = board.tiles();
  assert.equal(tiles[11]?.action?.type, "view");
  assert.equal(tiles[14]?.action?.type, "view");
  board.snapshot!.agents.push(agent("a12"));
  tiles = board.tiles();
  assert.equal(tiles[11]?.label, "Previous");
  assert.equal(tiles[14]?.label, "Next");
});

test("agents use real statuses, paginate and never borrow another session's agents", async () => {
  const board = boardWithAgents();
  board.snapshot!.agents = [
    agent("idle", "idle"), agent("done", "completed"), agent("bad", "failed"), agent("cancel", "cancelled"),
    ...Array.from({ length: 9 }, (_, i) => agent(`work-${i}`)),
  ];
  board.view = { type: "agents", page: 0, sessionId: "attached" };
  assert.equal(board.tiles()[0]?.activity, "working");
  assert.equal(board.tiles()[9]?.value, "Failed");
  await board.press(14);
  assert.equal(board.tiles()[0]?.value, "Waiting");
  assert.equal(board.tiles()[1]?.value, "Completed");
  assert.equal(board.tiles()[2]?.value, "Cancelled");
  board.snapshot!.agents = [];
  assert.equal(board.tiles()[0]?.label, "No subagents");
  assert.equal(board.view.page, 0);
  board.snapshot!.agents = [agent()];
  board.view = { type: "agents", page: 0, sessionId: "other" };
  assert.equal(board.targetSessionId, "other");
  assert.equal(board.tiles()[0]?.label, "No agent bridge");
  board.view = { type: "agents", page: 0, sessionId: "attached", follow: true };
  board.voice = { available: true, recording: false, mode: "toggle", activeSessionId: "other" };
  assert.equal(board.targetSessionId, "other");
  assert.equal(board.tiles()[0]?.label, "No agent bridge");
  board.loadingDetails = true;
  assert.equal(board.tiles()[0]?.label, "Loading agents");
});

test("agent detail handles removed tasks and freezes active time for idle agents", () => {
  const board = boardWithAgents();
  board.now = () => Date.parse("2026-10-20T22:00:10Z");
  board.snapshot!.agents = [{ ...agent(), model: "gpt-5.6-sol", activeTimeMs: 2000, activeStartedAt: "2026-10-20T22:00:05Z" }];
  board.view = { type: "agent", page: 0, sessionId: "attached", agentId: "a1" };
  assert.equal(board.tiles()[3]?.label, "GPT-5.6 Sol");
  assert.equal(board.tiles()[3]?.provider, "openai");
  assert.equal(board.tiles()[4]?.value, "7s");
  board.snapshot!.agents[0]!.status = "idle";
  assert.equal(board.tiles()[4]?.value, "2s");
  assert.equal(board.tiles()[1]?.label, "Waiting");
  board.snapshot!.agents = [];
  assert.equal(board.tiles()[0]?.label, "Agent no longer listed");
  board.snapshot!.capabilities.agents = { available: false, reason: "Agents unavailable" };
  assert.equal(board.tiles()[0]?.label, "Agents unavailable");
});
