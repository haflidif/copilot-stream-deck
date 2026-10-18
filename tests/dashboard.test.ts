import { test } from "node:test";
import assert from "node:assert/strict";
import { Dashboard } from "../src/plugin/dashboard.js";
import { renderTile, labelLines } from "../src/plugin/render.js";
import type { Command } from "../src/shared/protocol.js";
import { snapshot } from "./fixtures.js";

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
  assert.equal(board.tiles()[8]?.disabled, true);
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

test("session details never leak attached-session metrics onto another session", async () => {
  const { board } = setup();
  await board.press(2);
  await board.press(1);
  assert.equal(board.tiles()[2]?.value, "No data");
  assert.equal(board.tiles()[7]?.disabled, true);
});

test("open session uses the stable session id, not a position or title", async () => {
  const { board, commands } = setup();
  await board.press(2);
  await board.press(1);
  await board.press(0);
  assert.deepEqual(commands, [{ type: "openSession", id: "other" }]);
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
  assert.ok(labelLines("a very long session title with words").every((line) => [...line].length <= 15));
  assert.deepEqual(labelLines("azureviking_blog"), ["azureviking_", "blog"]);
  assert.deepEqual(labelLines("cost-optimization"), ["cost-", "optimization"]);
  assert.deepEqual(labelLines("lm-alz-documentation"), ["lm-alz-", "documentation"]);
  assert.deepEqual(labelLines("github-copilot-stream-deck"), ["github-copilot-", "stream-deck"]);
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
