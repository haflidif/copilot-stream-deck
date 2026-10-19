import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeToolResult, validateSessionLink } from "../src/bridge/app-tools.js";
import { AppProvider, normalizeSessions } from "../src/bridge/provider.js";
import { startBridge } from "../src/bridge/server.js";
import { parseCommand, parseDescriptor, parseSnapshot, type Command } from "../src/shared/protocol.js";
import { joinedSession, snapshot } from "./fixtures.js";

test("native tool parser handles JSON, prefixed JSON, and host spill files", async () => {
  assert.deepEqual(await decodeToolResult({ resultType: "success", textResultForLlm: 'Found 0 projects:\n[]' }), []);
  assert.deepEqual(await decodeToolResult({ resultType: "success", structuredContent: { sessions: [] } }), { sessions: [] });
  const path = join(tmpdir(), `test-copilot-tool-output-${crypto.randomUUID()}.txt`);
  try {
    await writeFile(path, 'Found 1 item(s):\n[{"id":"example"}]');
    assert.deepEqual(await decodeToolResult(`Output too large. Saved to: ${path}\nPreview...`), [{ id: "example" }]);
  } finally { await rm(path, { force: true }); }
});

test("native tool parser rejects failed, truncated and arbitrary-file results", async () => {
  await assert.rejects(decodeToolResult({ resultType: "failure", textResultForLlm: "Denied" }), /Denied/);
  await assert.rejects(decodeToolResult('Found 4 items:\n[{"id":"a"}'), /invalid or truncated/);
  await assert.rejects(decodeToolResult("Saved to: C:\\private\\secret.txt"), /unexpected/);
});

test("bridge startup prunes descriptors of dead processes and close keeps a replacement", async () => {
  const directory = await mkdtemp(join(tmpdir(), "copilot-deck-prune-"));
  try {
    const dead = { version: 1, sessionId: "dead", port: 1, token: "b".repeat(64), pid: 2147483646 };
    const alive = { ...dead, sessionId: "alive", pid: process.pid };
    await writeFile(join(directory, "dead.json"), JSON.stringify(dead));
    await writeFile(join(directory, "alive.json"), JSON.stringify(alive));
    const provider = { snapshot: async () => snapshot(), command: async () => {} };
    const bridge = await startBridge(provider, "same", directory);
    await assert.rejects(readFile(join(directory, "dead.json")));
    await readFile(join(directory, "alive.json"));
    const replacement = await startBridge(provider, "same", directory);
    await bridge.close();
    assert.equal(parseDescriptor(JSON.parse(await readFile(join(directory, "same.json"), "utf8"))).token, replacement.descriptor.token);
    await replacement.close();
    await assert.rejects(readFile(join(directory, "same.json")));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("status normalization prioritizes attention and never infers completion from idle", () => {
  const sessions = normalizeSessions({ sessions: [
    { id: "a", name: "A", project_id: "p", activity: { status: "busy" }, awaiting_plan_approval: true },
    { id: "b", name: "B", activity: { status: "idle" } },
    { id: "c", name: "C" },
  ] });
  assert.equal(sessions[0]?.activity, "attention");
  assert.equal(sessions[1]?.activity, "idle");
  assert.equal(sessions[1]?.kind, "chat");
  assert.equal(sessions[2]?.activity, "unknown");
});

test("an unnamed new chat gets a fallback name instead of breaking the session list", () => {
  const sessions = normalizeSessions({ sessions: [
    { id: "new", name: "" },
    { id: "work", project_id: "p" },
    { name: "no id" },
    { id: "ok", name: "Ok" },
  ] });
  assert.deepEqual(sessions.map((s) => `${s.id}:${s.name}`), ["new:New chat", "work:New session", "ok:Ok"]);
});

test("provider combines app-wide state and attached-session metrics, with one shared refresh", async () => {
  const session = joinedSession();
  let calls = 0;
  const execute = session.rpc.tools.execute;
  session.rpc.tools.execute = async (params) => { calls++; return execute(params); };
  const provider = new AppProvider(session);
  try {
    const [first, second] = await Promise.all([provider.snapshot(), provider.snapshot()]);
    assert.equal(first, second);
    assert.equal(calls, 2);
    assert.equal(first.projects[0]?.name, "Example");
    assert.equal(first.details?.aiCredits, 2.5);
    assert.equal(first.details?.contextPercent, 25);
    assert.equal(first.capabilities.voice.available, false);
    assert.equal(first.capabilities.appPins.available, false);
    assert.deepEqual(first.errors, []);
    parseSnapshot(JSON.parse(JSON.stringify(first)));
  } finally { provider.dispose(); }
});

test("unavailable app tools fail explicitly while current-session features stay usable", async () => {
  const session = joinedSession();
  session.rpc.tools.getCurrentMetadata = async () => ({ tools: [] });
  const provider = new AppProvider(session);
  try {
    const result = await provider.snapshot();
    assert.equal(result.capabilities.projects.available, false);
    assert.equal(result.capabilities.details.available, true);
    assert.ok(result.errors.some((message) => message.includes("list_projects")));
    await assert.rejects(provider.command({ type: "newChat" }), /unavailable/);
  } finally { provider.dispose(); }
});

test("native command failures propagate and stale session targets are rejected", async () => {
  const session = joinedSession();
  const provider = new AppProvider(session);
  try {
    await provider.snapshot();
    session.rpc.tools.execute = async () => ({ resultType: "denied", textResultForLlm: "Denied by host" });
    await assert.rejects(provider.command({ type: "openSession", id: "attached" }), /Denied by host/);
    await assert.rejects(provider.command({ type: "openSession", id: "deleted" }), /no longer available/);
  } finally { provider.dispose(); }
});

test("open uses the app-provided session link and never calls agent navigation", async () => {
  const session = joinedSession();
  const opened: string[] = [];
  const calls: string[] = [];
  const execute = session.rpc.tools.execute;
  session.rpc.tools.execute = async (params) => { calls.push(params.name); return execute(params); };
  const provider = new AppProvider(session, async (url) => { opened.push(url); });
  try {
    await provider.command({ type: "openSession", id: "attached" });
    assert.deepEqual(opened, ["ghapp://sessions/attached"]);
    assert.ok(!calls.includes("navigate_to"));
    assert.equal(validateSessionLink("ghapp://sessions/attached", "attached"), "ghapp://sessions/attached");
    for (const url of ["https://example.com", "file:///C:/Windows", "ghapp://sessions/other", "ghapp://sessions/attached?x=1"]) {
      assert.throws(() => validateSessionLink(url, "attached"), /Invalid Copilot/);
    }
    session.rpc.tools.execute = async (params) => params.name === "list_sessions_and_chats" ? ({
      resultType: "success", textResultForLlm: JSON.stringify([{ id: "attached", app_url: "https://example.com" }]),
    }) : execute(params);
    await assert.rejects(provider.command({ type: "openSession", id: "attached" }), /Invalid Copilot/);
    assert.equal(opened.length, 1);
  } finally { provider.dispose(); }
});

test("session link launch failures are surfaced", async () => {
  const provider = new AppProvider(joinedSession(), async () => { throw new Error("URL handler failed"); });
  try {
    await assert.rejects(provider.command({ type: "openSession", id: "attached" }), /URL handler failed/);
  } finally { provider.dispose(); }
});

test("new-chat command creates an idle standalone local chat without a kickoff or code checkout", async () => {
  const session = joinedSession();
  const calls: unknown[] = [];
  const execute = session.rpc.tools.execute;
  session.rpc.tools.execute = async (params) => { calls.push(params); return execute(params); };
  const provider = new AppProvider(session);
  try {
    await provider.command({ type: "newChat" });
    assert.deepEqual(calls.at(-1), {
      name: "create_session",
      arguments: { session_kind: "chat", coordinate_with_creator: false },
    });
  } finally { provider.dispose(); }
});

test("loopback bridge requires authentication, rejects browser origins, and dispatches only allowlisted commands", async () => {
  const directory = await mkdtemp(join(tmpdir(), "stream-deck-bridge-test-"));
  const commands: Command[] = [];
  const bridge = await startBridge({ snapshot: async () => snapshot(), command: async (command) => { commands.push(command); } }, "test-session", directory);
  const url = `http://127.0.0.1:${bridge.descriptor.port}/v1`;
  const auth = { Authorization: `Bearer ${bridge.descriptor.token}` };
  try {
    assert.equal((await fetch(`${url}/snapshot`)).status, 403);
    assert.equal((await fetch(`${url}/snapshot`, { headers: { ...auth, Origin: "https://example.com" } })).status, 403);
    assert.equal((await fetch(`${url}/snapshot`, { headers: auth })).status, 200);
    const options = { method: "POST", headers: { ...auth, "Content-Type": "application/json" } };
    assert.equal((await fetch(`${url}/command`, { ...options, body: '{"type":"shell","command":"no"}' })).status, 500);
    assert.equal((await fetch(`${url}/command`, { ...options, body: '{"type":"newChat"}' })).status, 200);
    assert.deepEqual(commands, [{ type: "newChat" }]);
    const descriptor = parseDescriptor(JSON.parse(await readFile(join(directory, "test-session.json"), "utf8")));
    assert.equal(descriptor.port, bridge.descriptor.port);
  } finally {
    await bridge.close();
    await assert.rejects(readFile(join(directory, "test-session.json")), /ENOENT/);
    await rm(directory, { recursive: true });
  }
});

test("protocol rejects invalid addresses, command state, and malformed snapshots", () => {
  assert.throws(() => parseDescriptor({ version: 1, port: 90000, token: "x" }), /Invalid/);
  assert.throws(() => parseCommand({ type: "setMcp", name: "example", enabled: "false" }), /Invalid/);
  assert.throws(() => parseSnapshot({ version: 1 }), /Incompatible/);
  const data = snapshot();
  assert.throws(() => parseSnapshot({ ...data, sessions: [{ ...data.sessions[0], activity: "finished" }] }), /Invalid session activity/);
});
