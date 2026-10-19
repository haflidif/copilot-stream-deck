import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMcpServers, parseNavFeed, withNavFeed } from "../src/plugin/companion.js";
import { Dashboard } from "../src/plugin/dashboard.js";
import { renderTile } from "../src/plugin/render.js";
import { snapshot } from "./fixtures.js";

const message = {
  type: "snapshot", protocolVersion: 1,
  root: { items: [
    { kind: "pinned", id: "pinned", label: "Pinned" },
    { kind: "chats", id: "chats", label: "Chats" },
    { kind: "project", id: "p-1", label: "Deck", accentToken: "blue" },
    { kind: "project", id: "bad id!", label: "Nope" },
    { kind: "project", id: "p-2", label: "Plain", accentToken: "neutral" },
  ] },
  collections: {
    pinned: { items: [{ kind: "workspace", id: "s-1", label: "Pinned copy", status: "idle" }] },
    chats: { items: [{ kind: "chat", id: "c-1", label: "", status: "running" }] },
    "project:p-1": { items: [
      { kind: "workspace", id: "s-1", label: "Feed work", status: "attention" },
      { kind: "workspace", id: "s-2", label: "Broken", status: "interrupted", accentToken: "green" },
      { kind: "workspace", id: "s-3", label: "Ship it", status: "attention", indicatorKind: "merge_ready" },
      { kind: "workspace", status: "idle" },
    ] },
  },
};

test("reads projects and sessions from the app sidebar", () => {
  const feed = parseNavFeed(message);
  assert.deepEqual(feed?.projects, [{ id: "p-1", name: "Deck", accent: "blue" }, { id: "p-2", name: "Plain" }]);
  assert.deepEqual(feed?.sessions, [
    { id: "s-1", name: "Feed work", kind: "session", activity: "attention", projectId: "p-1", pinned: true },
    { id: "c-1", name: "New chat", kind: "chat", activity: "working" },
    { id: "s-2", name: "Broken", kind: "session", activity: "error", projectId: "p-1", accent: "green" },
    { id: "s-3", name: "Ship it", kind: "session", activity: "ready", projectId: "p-1" },
  ]);
  assert.equal(parseNavFeed({ type: "voice" }), undefined);
});

test("the feed replaces bridge lists and stands in when no bridge answers", () => {
  const feed = parseNavFeed(message)!;
  const base = snapshot();
  const merged = withNavFeed({ ...base, errors: ["sessions: Invalid session name", "mcp: down"] }, feed, "s-1");
  assert.equal(merged.sessions.length, 4);
  assert.deepEqual(merged.errors, ["mcp: down"]);
  assert.equal(merged.capabilities.sessions.available, true);
  assert.equal(merged.mcp, base.mcp);

  const alone = withNavFeed(undefined, feed, "s-1");
  assert.equal(alone.bridgeSessionId, "s-1");
  assert.equal(alone.capabilities.openSession.available, true);
  assert.equal(alone.capabilities.newChat.available, false);
  assert.deepEqual(alone.errors, []);
});

test("MCP servers come from the app for its active session and toggle only while unchanged", async () => {
  assert.deepEqual(parseMcpServers({ loaded: true, items: [
    { id: "second-brain", name: "second-brain", enabled: false, toggleable: true, status: "pending" },
    { id: "azure", name: "Azure", enabled: true, toggleable: false },
    { id: "bad id!", name: "x", enabled: true },
  ] }), [
    { id: "second-brain", name: "second-brain", enabled: false, toggleable: true, pending: true },
    { id: "azure", name: "Azure", enabled: true, toggleable: false, pending: false },
  ]);
  assert.equal(parseMcpServers({ loaded: false, items: [] }), undefined);

  const sent: unknown[] = [];
  const board = new Dashboard(async () => {}, async () => {}, async (request) => { sent.push(request); });
  board.snapshot = withNavFeed(undefined, parseNavFeed(message)!, "s-1");
  board.voice = { available: true, recording: false, mode: "toggle", activeSessionId: "s-1", mcp: [
    { id: "playwright", name: "Playwright", enabled: true, toggleable: true, pending: false },
    { id: "azure", name: "Azure", enabled: true, toggleable: false, pending: false },
    { id: "second-brain", name: "second-brain", enabled: true, toggleable: true, pending: true },
  ] };
  assert.equal(board.tiles()[4]?.disabled, false);
  await board.press(4);
  assert.deepEqual(board.tiles().slice(0, 3).map((tile) => [tile.label, tile.value, tile.disabled]),
    [["Playwright", "ON", false], ["Azure", "ON", true], ["second-brain", "ON", false]]);
  await board.press(0);
  assert.equal(board.tiles()[2]?.label, "Disable Playwright?");
  board.voice = { ...board.voice, mcp: [{ id: "playwright", name: "Playwright", enabled: false, toggleable: true, pending: false }] };
  assert.equal(board.tiles()[0]?.label, "Changed in app");
  board.voice = { ...board.voice, mcp: [{ id: "playwright", name: "Playwright", enabled: true, toggleable: true, pending: false }] };
  await board.press(0);
  assert.deepEqual(sent, [{ type: "mcp.toggle", serverId: "playwright" }]);
  assert.equal(board.view.type, "mcp");
});

test("project colours from the app show as a strip on project and session tiles", async () => {
  const board = new Dashboard(async () => {}, async () => {});
  board.snapshot = withNavFeed(snapshot(), parseNavFeed(message)!, "s-1");
  await board.press(1);
  assert.deepEqual(board.tiles().slice(0, 2).map((tile) => tile.accent), ["blue", undefined]);
  await board.press(0);
  assert.deepEqual(board.tiles().slice(0, 3).map((tile) => tile.accent), ["blue", "green", "blue"]);
  assert.match(renderTile({ label: "Deck", accent: "blue", icon: "folder" }), /<rect width="144" height="12" fill="#58a6ff"[\s\S]*fill="#58a6ff"/);
  assert.match(renderTile({ label: "Deck", accent: "blue", value: "D", activity: "attention" }), /fill="#ffc569"/);
  assert.doesNotMatch(renderTile({ label: "Deck", accent: "mystery" }), /height="12"/);
  assert.doesNotMatch(renderTile({ label: "Deck", accent: "__proto__" }), /height="12"/);
});

test("the home Pinned tile lists app pins alongside local favorites", async () => {
  const board = new Dashboard(async () => {}, async () => {});
  board.snapshot = withNavFeed(snapshot(), parseNavFeed(message)!, "s-1");
  board.favorites = new Set(["c-1"]);
  assert.equal(board.tiles()[3]?.label, "Pinned");
  await board.press(3);
  assert.deepEqual(board.tiles().slice(0, 2).map((tile) => tile.label), ["Feed work", "New chat"]);
  assert.notEqual(board.tiles()[2]?.label, "Broken");
});
