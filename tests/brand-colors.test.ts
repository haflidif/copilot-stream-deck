import test from "node:test";
import assert from "node:assert/strict";
import { renderTile } from "../src/plugin/render.js";

test("icons use GitHub brand colours unless a status or project colour applies", () => {
  assert.match(renderTile({ label: "Open in app", icon: "open" }), /fill="#f0f6fc"/);
  assert.match(renderTile({ label: "Sessions", icon: "copilot" }), /<linearGradient id="icon-copilot"[\s\S]*fill="url\(#icon-copilot\)"/);
  assert.match(renderTile({ label: "Needs you", icon: "folder", activity: "attention" }), /scale\([\d.]+\)" fill="#ffc569"/);
  assert.match(renderTile({ label: "Deck", icon: "folder", accent: "green" }), /scale\([\d.]+\)" fill="#3fb950"/);
  assert.doesNotMatch(renderTile({ label: "Talking", icon: "mic", recording: true }), /#56d4dd/);
});
