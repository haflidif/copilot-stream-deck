import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNavFeed, withNavFeed } from "../src/plugin/companion.js";
import { Dashboard } from "../src/plugin/dashboard.js";
import { snapshot } from "./fixtures.js";

const message = {
  type: "snapshot", protocolVersion: 1,
  root: { items: [
    { kind: "pinned", id: "pinned", label: "Pinned" },
    { kind: "chats", id: "chats", label: "Chats" },
    { kind: "project", id: "p-1", label: "Deck" },
    { kind: "project", id: "bad id!", label: "Nope" },
  ] },
  collections: {
    pinned: { items: [{ kind: "workspace", id: "s-1", label: "Pinned copy", status: "idle" }] },
    chats: { items: [{ kind: "chat", id: "c-1", label: "", status: "running" }] },
    "project:p-1": { items: [
      { kind: "workspace", id: "s-1", label: "Feed work", status: "attention" },
      { kind: "workspace", id: "s-2", label: "Broken", status: "interrupted" },
      { kind: "workspace", id: "s-3", label: "Ship it", status: "attention", indicatorKind: "merge_ready" },
      { kind: "workspace", status: "idle" },
    ] },
  },
};

test("reads projects and sessions from the app sidebar", () => {
  const feed = parseNavFeed(message);
  assert.deepEqual(feed?.projects, [{ id: "p-1", name: "Deck" }]);
  assert.deepEqual(feed?.sessions, [
    { id: "s-1", name: "Feed work", kind: "session", activity: "attention", projectId: "p-1", pinned: true },
    { id: "c-1", name: "New chat", kind: "chat", activity: "working" },
    { id: "s-2", name: "Broken", kind: "session", activity: "error", projectId: "p-1" },
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

test("the home Pinned tile lists app pins alongside local favorites", async () => {
  const board = new Dashboard(async () => {}, async () => {});
  board.snapshot = withNavFeed(snapshot(), parseNavFeed(message)!, "s-1");
  board.favorites = new Set(["c-1"]);
  assert.equal(board.tiles()[3]?.label, "Pinned");
  await board.press(3);
  assert.deepEqual(board.tiles().slice(0, 2).map((tile) => tile.label), ["Feed work", "New chat"]);
  assert.notEqual(board.tiles()[2]?.label, "Broken");
});
