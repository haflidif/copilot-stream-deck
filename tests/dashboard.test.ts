import { test } from "node:test";
import assert from "node:assert/strict";
import { Dashboard, modelTile } from "../src/plugin/dashboard.js";
import { renderTile, labelLines } from "../src/plugin/render.js";
import type { Command } from "../src/shared/protocol.js";
import { snapshot } from "./fixtures.js";
import { icons } from "../src/plugin/icons.js";

function setup() {
  const commands: Command[] = [];
  let favorites: string[] = [];
  const board = new Dashboard(async (command) => { commands.push(command); }, async (ids) => { favorites = ids; });
  board.snapshot = snapshot();
  return { board, commands, favorites: () => favorites };
}

test("home has 15 tiles and never advertises unverified voice or pins", () => {
  const { board } = setup();
  assert.equal(board.tiles().length, 15);
  assert.equal(board.tiles()[7]?.disabled, true);
  assert.equal(board.tiles()[8]?.label, "Needs you");
});

test("projects drill down into sessions and Back preserves the parent", async () => {
  const { board } = setup();
  await board.press(1);
  assert.equal(String(board.view.type), "projects");
  await board.press(0);
  assert.equal(String(board.view.type), "sessions");
  assert.equal(board.tiles()[0]?.activity, "working");
  await board.press(10);
  assert.equal(String(board.view.type), "projects");
});

test("context ring fills up from empty, eases to new values, and jumps with reduced motion", async () => {
  const { board } = setup();
  await board.press(6);
  const goal = board.tiles()[4]!.gauge!;
  board.view = { type: "home", page: 0 };
  board.tiles();
  await board.press(6);
  const first = board.tiles()[4]!;
  assert.equal(first.gauge, goal);
  assert.ok(first.ring! > 0 && first.ring! < goal);
  const second = board.tiles()[4]!.ring!;
  assert.ok(second > first.ring! && second < goal);
  for (let i = 0; i < 30; i++) board.tiles();
  assert.equal(board.tiles()[4]!.ring, goal);
  board.view = { type: "home", page: 0 };
  board.tiles();
  board.reducedMotion = true;
  await board.press(6);
  assert.equal(board.tiles()[4]!.ring, goal);
});

test("model and reasoning pickers confirm before switching this session", async () => {
  const { board, commands } = setup();
  await board.press(6);
  assert.ok(board.tiles()[2]?.action);
  assert.equal(board.tiles()[3]?.label, "Auto mode");
  assert.ok(board.tiles()[3]?.action);
  await board.press(2);
  assert.equal(String(board.view.type), "models");
  assert.equal(board.tiles()[0]?.selected, true);
  await board.press(1);
  assert.equal(String(board.view.type), "confirm");
  assert.equal(board.tiles()[2]?.label, "Switch to Claude Sonnet 5?");
  await board.press(0);
  assert.deepEqual(commands.at(-1), { type: "setModel", modelId: "claude-sonnet-5" });
  assert.equal(board.targetSessionId, "attached");

  board.snapshot = { ...snapshot(), details: { ...snapshot().details!, model: "claude-sonnet-5", reasoning: "low" } };
  board.view = { type: "reasoning", page: 0, sessionId: "attached" };
  assert.deepEqual(board.tiles().slice(0, 3).map((tile) => tile.label), ["Low", "Medium", "High"]);
  assert.equal(board.tiles()[0]?.selected, true);
  await board.press(2);
  await board.press(0);
  assert.deepEqual(commands.at(-1), { type: "setModel", modelId: "claude-sonnet-5", reasoning: "high" });
});

test("Auto in the model list asks for a mode before confirming", async () => {
  const { board, commands } = setup();
  board.snapshot = { ...snapshot(), details: { ...snapshot().details!, model: "claude-sonnet-5" } };
  board.view = { type: "models", page: 0, sessionId: "attached" };
  await board.press(0);
  assert.equal(String(board.view.type), "reasoning");
  assert.deepEqual(board.tiles().slice(0, 3).map((tile) => tile.label), ["Efficiency", "Balance", "Intelligence"]);
  assert.equal(board.tiles().some((tile) => tile.selected), false);
  await board.press(2);
  assert.equal(board.tiles()[2]?.label, "Auto: intelligence?");
  await board.press(0);
  assert.deepEqual(commands.at(-1), { type: "setModel", modelId: "auto", reasoning: "intelligence" });
});

test("model picker stays off for other sessions", async () => {
  const { board } = setup();
  await board.press(2);
  await board.press(1);
  assert.equal(board.tiles()[2]?.action, undefined);
});

test("session details never leak attached-session metrics onto another session", async () => {
  const { board } = setup();
  await board.press(2);
  await board.press(1);
  assert.equal(board.tiles()[2]?.value, "No bridge");
  assert.equal(board.tiles()[9]?.label, "Needs you");
  assert.equal(board.tiles()[9]?.activity, "attention");
  assert.match(board.detailsMessage!, /stop an idle session's runtime/);
  assert.match(board.detailsMessage!, /Switching tabs does not guarantee/);
  assert.doesNotMatch(board.detailsMessage!, /reload its extensions/);
  assert.equal(board.tiles()[7]?.disabled, true);
});

test("opening a session is a request, not a confirmed switch, and duplicate presses are ignored", async () => {
  const { board, commands } = setup();
  await board.press(2);
  await board.press(1);
  board.loadingDetails = true;
  assert.equal(board.tiles()[2]?.value, "Loading");
  board.loadingDetails = false;
  await board.press(0);
  assert.equal(board.tiles()[0]?.label, "Open requested");
  await board.press(0);
  assert.equal(commands.length, 1);
  await board.press(10);
  await board.press(1);
  assert.equal(board.tiles()[0]?.label, "Open in app");
});

test("open session uses the stable session id, not a position or title", async () => {
  const { board, commands } = setup();
  await board.press(2);
  await board.press(1);
  await board.press(0);
  assert.deepEqual(commands, [{ type: "openSession", id: "other" }]);
});

test("selected session bridge stays targeted through MCP confirmation and Back", async () => {
  const { board } = setup();
  await board.press(2);
  await board.press(1);
  assert.equal(board.targetSessionId, "other");
  const data = snapshot();
  data.bridgeSessionId = "other";
  data.details = { id: "other", name: "Other", model: "other-model" };
  board.snapshot = data;
  assert.equal(board.tiles()[2]?.value, "other-model");
  assert.equal(board.tiles()[7]?.disabled, false);
  await board.press(7);
  assert.equal(board.targetSessionId, "other");
  await board.press(0);
  assert.equal(board.targetSessionId, "other");
  await board.press(1);
  assert.equal(board.targetSessionId, "other");
  await board.press(10);
  await board.press(10);
  assert.equal(board.targetSessionId, undefined);
});

test("MCP changes require confirmation and carry an explicit target state", async () => {
  const { board, commands } = setup();
  await board.press(4);
  await board.press(0);
  assert.equal(commands.length, 0);
  assert.equal(board.view.type, "confirm");
  await board.press(0);
  assert.deepEqual(commands, [{ type: "setMcp", name: "example", enabled: false }]);
});

test("new chat cannot be created with one accidental press", async () => {
  const { board, commands } = setup();
  await board.press(0);
  assert.equal(commands.length, 0);
  await board.press(1);
  assert.equal(commands.length, 0);
  await board.press(0);
  await board.press(0);
  assert.deepEqual(commands, [{ type: "newChat" }]);
});

test("favorites persist only after a successful settings write", async () => {
  const { board, favorites } = setup();
  await board.press(6);
  await board.press(1);
  assert.deepEqual(favorites(), ["attached"]);
  assert.equal(board.favorites.has("attached"), true);
  const broken = new Dashboard(async () => {}, async () => { throw new Error("Storage unavailable"); });
  broken.snapshot = snapshot();
  await broken.press(6);
  await assert.rejects(broken.press(1), /Storage unavailable/);
  assert.equal(broken.favorites.size, 0);
});

test("pagination clamps after a shrinking live list and Back returns to the same page", async () => {
  const { board } = setup();
  board.snapshot!.projects = Array.from({ length: 21 }, (_, n) => ({ id: `p${n}`, name: `Project ${n}` }));
  await board.press(1);
  await board.press(14);
  assert.equal(board.tiles()[0]?.label, "Project 10");
  await board.press(0);
  await board.press(10);
  assert.equal(board.view.page, 1);
  board.snapshot!.projects = [];
  board.tiles();
  assert.equal(board.view.page, 0);
});

test("unknown activity is not presented as completed", async () => {
  const { board } = setup();
  board.snapshot!.sessions[0]!.activity = "unknown";
  await board.press(2);
  assert.equal(board.tiles()[0]?.activity, "unknown");
});

test("animation changes frames, reduced motion freezes them, and text is escaped", () => {
  const tile = { label: '<tag> & "x"', activity: "working" as const };
  assert.notEqual(renderTile(tile, 0), renderTile(tile, 5));
  assert.equal(renderTile(tile, 0, true), renderTile(tile, 5, true));
  assert.match(renderTile(tile), /&lt;tag&gt; &amp; &quot;x&quot;/);
  assert.equal(labelLines("a very long session title with words").length, 2);
  assert.ok(labelLines("a very long session title with words").every((line) => [...line].length <= 12));
  assert.deepEqual(labelLines("azureviking_blog"), ["azureviking_", "blog"]);
  assert.deepEqual(labelLines("cost-optimization"), ["cost-", "optimization"]);
  assert.deepEqual(labelLines("lm-alz-documentation", 14), ["lm-alz-", "documentation"]);
  assert.deepEqual(labelLines("github-copilot-stream-deck", 15), ["github-copilot-", "stream-deck"]);
  const long = renderTile({ label: "lm-alz-documentation" });
  assert.match(long, /font-size="18"[^>]*>documentation</);
});

test("unused positions stay blank rather than looking like active controls", () => {
  assert.doesNotMatch(renderTile({ label: "" }), /<text|<circle/);
  assert.equal(renderTile({ label: "" }, 0), renderTile({ label: "" }, 5));
});

test("repeated presses cannot dispatch duplicate in-flight commands", async () => {
  let resolve!: () => void;
  let calls = 0;
  const board = new Dashboard(async () => { calls++; await new Promise<void>((r) => { resolve = r; }); }, async () => {});
  board.snapshot = snapshot();
  await board.press(0);
  const first = board.press(0);
  await board.press(0);
  assert.equal(calls, 1);
  resolve();
  await first;
});

test("non-running sessions show saved history values without enabling MCP", async () => {
  const { board } = setup();
  await board.press(2);
  await board.press(1);
  const id = board.targetSessionId!;
  board.savedDetails = { id: "unrelated", name: "Other", source: "saved", model: "wrong" };
  assert.equal(board.tiles()[2]?.value, "No bridge");
  board.savedDetails = { id, name: "Saved", source: "saved", model: "gpt-6-luna", contextPercent: 68.7, contextLimit: 272000, aiCredits: 20.6, creditsStatus: "complete" };
  const tiles = board.tiles();
  assert.equal(tiles[2]?.value, "gpt-6-luna");
  assert.equal(tiles[4]?.value, "69%");
  assert.equal(tiles[6]?.value, "20.6");
  assert.equal(tiles[7]?.disabled, true);
  assert.equal(tiles[9]?.label, "Needs you");
  board.snapshot = { ...board.snapshot!, sessions: board.snapshot!.sessions.map((row) => row.id === id ? { ...row, activity: "unknown" as const } : row) };
  assert.equal(board.tiles()[9]?.label, "Saved values");
  assert.match(board.detailsMessage!, /last saved values/);
});

test("context gauge renders a clamped ring coloured by usage", () => {
  const low = renderTile({ label: "Context used", value: "25%", gauge: 25 });
  assert.match(low, /#5be3a5/);
  assert.match(low, /stroke-dasharray="56\.5 226\.2"/);
  assert.match(low, />25%</);
  assert.doesNotMatch(low, /fill="#21262d"/);
  assert.match(renderTile({ label: "Context used", gauge: 70 }), /#ffc569/);
  const full = renderTile({ label: "Context used", gauge: 140 });
  assert.match(full, /#ff747e/);
  assert.match(full, />100%</);
  const easing = renderTile({ label: "Context used", gauge: 80, ring: 40 });
  assert.match(easing, />40%</);
});

test("Needs you counts and filters sessions waiting on the user", async () => {
  const { board } = setup();
  const tile = board.tiles()[8]!;
  const waiting = board.snapshot!.sessions.filter((row) => row.activity === "attention");
  assert.ok(waiting.length > 0);
  assert.equal(tile.value, String(waiting.length));
  assert.equal(tile.activity, "attention");
  await board.press(8);
  assert.deepEqual(board.tiles().slice(0, 10).filter((row) => row.action).map((row) => row.label), waiting.map((row) => row.name));
});

test("a session that stops working flashes for a moment, but not on first load", async () => {
  const { board } = setup();
  let now = 1000;
  board.now = () => now;
  const working = board.snapshot!.sessions.find((row) => row.activity === "working")!;
  assert.ok(working);
  assert.equal(board.tiles()[9]!.label, "Live sessions");
  board.snapshot = { ...board.snapshot!, sessions: board.snapshot!.sessions.map((row) => row.id === working.id ? { ...row, activity: "idle" } : row) };
  const home = board.tiles()[9]!;
  assert.equal(home.label, "Finished");
  assert.equal(home.flash, true);
  assert.match(renderTile(home, 0), /stroke="#5be3a5" stroke-width="5"/);
  await board.press(9);
  assert.deepEqual(board.tiles().filter((row) => row.action?.type === "view").map((row) => [row.label, row.flash]), [[working.name, true]]);
  now += Dashboard.finishedMs;
  assert.equal(board.tiles().some((row) => row.flash), false);
});

test("opening a finished session on the deck clears its flash", async () => {
  const { board } = setup();
  const working = board.snapshot!.sessions.find((row) => row.activity === "working")!;
  board.tiles();
  board.snapshot = { ...board.snapshot!, sessions: board.snapshot!.sessions.map((row) => row.id === working.id ? { ...row, activity: "idle" } : row) };
  await board.press(9);
  await board.press(0);
  board.tiles();
  await board.press(10);
  await board.press(10);
  assert.equal(board.view.type, "home");
  assert.equal(board.tiles()[9]!.label, "Live sessions");
});

test("Live sessions opens the sessions that are working", async () => {
  const { board } = setup();
  const working = board.snapshot!.sessions.filter((row) => row.activity === "working");
  await board.press(9);
  assert.deepEqual(board.tiles().filter((row) => row.action?.type === "view").map((row) => row.label), working.map((row) => row.name));
});

test("model tile shows a provider badge and a readable model name", () => {
  assert.deepEqual(modelTile("gpt-6-astra"), { label: "GPT-6 Astra", provider: "openai" });
  assert.deepEqual(modelTile("claude-sonnet-5.5"), { label: "Sonnet 5.5", provider: "anthropic" });
  assert.deepEqual(modelTile("gemini-3.8-flash"), { label: "Gemini 3.8 Flash", provider: "google" });
  assert.deepEqual(modelTile("grok-4.7"), { label: "Grok 4.7", provider: "xai" });
  assert.deepEqual(modelTile("mai-code-1.1-flash"), { label: "MAI Code 1.1 Flash", provider: "microsoft" });
  assert.deepEqual(modelTile("auto"), { label: "Auto", provider: "auto" });
  assert.deepEqual(modelTile("Auto → Claude Opus 5.5"), { label: "Auto: Opus 5.5", provider: "anthropic" });
  assert.deepEqual(modelTile("some-new-model"), { label: "Model" });
  assert.deepEqual(modelTile(undefined), { label: "Model" });
  const svg = renderTile({ label: "GPT-6 Astra", value: "gpt-6-astra", provider: "openai" });
  assert.match(svg, /<g transform="translate\([^"]+\) scale\([^"]+\)" fill="#ffffff"/);
  assert.match(renderTile({ label: "Sonnet 5.5", value: "claude-sonnet-5.5", provider: "anthropic" }), /fill="#D97757"/);
  assert.doesNotMatch(svg, />gpt-6-astra</);
  assert.match(renderTile({ label: "Model", value: "x", provider: "__proto__" as never }), />x</);
});

test("attention tiles pulse unless motion is reduced", () => {
  const tile = { label: "Other session", value: "OS", activity: "attention" as const };
  const dim = renderTile(tile, 0);
  const bright = renderTile(tile, 5);
  assert.match(dim, /stroke-width="4" opacity="0.15"/);
  assert.match(bright, /stroke-width="4" opacity="1"/);
  assert.doesNotMatch(renderTile(tile, 5, true), /stroke-width="4" opacity=/);
  assert.doesNotMatch(renderTile({ ...tile, disabled: true }, 5), /stroke-width="4" opacity=/);
});
test("every icon renders as valid single-path SVG data", () => {
  for (const icon of Object.keys(icons) as (keyof typeof icons)[]) {
    const svg = renderTile({ label: "x", icon });
    assert.match(svg, /<path d="[Mm][^"<>]+"\/>/, icon);
    assert.doesNotMatch(svg, /d="<|<\/path>/, icon);
  }
});
