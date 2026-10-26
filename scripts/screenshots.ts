// Renders README screenshots from made-up demo data, so no real project or session names end up in the repo.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { Dashboard } from "../src/plugin/dashboard.js";
import { renderTile } from "../src/plugin/render.js";
import { caption, deck, deckHeight, deckWidth, demo, inline, key, page } from "./demo.js";
import type { Tile } from "../src/plugin/dashboard.js";

const out = resolve("docs/images");
await mkdir(out, { recursive: true });

async function shot(name: string, svg: string): Promise<void> {
  await writeFile(resolve(out, `${name}.png`), new Resvg(svg, { font: { loadSystemFonts: true } }).render().asPng());
  console.log(`Wrote docs\\images\\${name}.png`);
}

let now = 1_000_000;
const board = new Dashboard(async () => {}, async () => {});
board.now = () => now;
board.snapshot = demo();
board.tiles();
// "Add rate limits" just finished, so Home shows the Finished key mid-confetti.
board.snapshot = { ...board.snapshot, sessions: board.snapshot.sessions.map((row) => row.id === "s3" ? { ...row, activity: "idle" as const } : row) };
board.tiles();
now += Dashboard.confettiMs * 0.2;

// The context ring eases up from empty each time a session opens, so let it settle before taking a picture.
function settled(): Tile[] {
  for (let i = 0; i < 40; i++) board.tiles();
  return board.tiles();
}

const views: [string, Dashboard["view"]][] = [
  ["home", { type: "home", page: 0 }],
  ["projects", { type: "projects", page: 0 }],
  ["sessions", { type: "sessions", page: 0 }],
  ["session", { type: "session", id: "s1", page: 0 }],
];
for (const [name, view] of views) {
  board.view = view;
  await shot(name, page(deckWidth + 40, deckHeight + 40, deck(settled(), 6, 20, 20)));
}

// Hero image: Home and a session side by side.
board.view = { type: "home", page: 0 };
const home = settled();
board.view = { type: "session", id: "s1", page: 0 };
const session = settled();
const heroWidth = deckWidth * 2 + 100, heroHeight = deckHeight + 100;
await shot("hero", page(heroWidth, heroHeight,
  caption(34, 44, "Home") + deck(home, 6, 30, 64) + caption(deckWidth + 74, 44, "Session") + deck(session, 6, deckWidth + 70, 64)));

// Copilot moods and the confetti burst, as strips of single keys.
const strip = (items: [string, Tile, number][]) => {
  const width = items.length * (key + 30) + 30;
  return { width, svg: page(width, key + 80, items.map(([label, tile, frame], i) =>
    `<text x="${30 + i * (key + 30) + key / 2}" y="34" text-anchor="middle" fill="#8b949e" font-family="Segoe UI, Arial, sans-serif" font-size="16">${label}</text>` +
    inline(renderTile(tile, frame, false), `s${i}-`, 30 + i * (key + 30), 50)).join("")) };
};
const moods = strip([
  ["Working", { label: "Working", busy: 2 }, 0],
  ["Sleeping", { label: "Sleeping", busy: 0 }, 0],
  ["Needs you", { label: "Psst!", busy: 1, mood: { alert: true } }, 2],
  ["Context nearly full", { label: "Working", busy: 1, mood: { sweat: true } }, 20],
]);
await shot("moods", moods.svg);
const finished: Tile = { label: "Finished", icon: "check", activity: "ready", flash: true };
const confetti = strip([0.05, 0.13, 0.4, 0.5, 0.75, 0.85].map((p, i) => [`${(p * Dashboard.confettiMs / 1000).toFixed(1)} s`, { ...finished, confetti: p }, i] as [string, Tile, number]));
await shot("confetti", confetti.svg);

// Squad team: the session's Agents key, the Agents list with roster names, and one member's page.
const squad = new Dashboard(async () => {}, async () => {});
squad.now = () => now;
squad.snapshot = { ...demo(), squad: true, agents: [
  { id: "q1", name: "neo-impl", member: "Neo", role: "Lead", agentType: "general-purpose", status: "running", startedAt: "2026-10-21T07:00:00Z", activeTimeMs: 162000, model: "claude-opus-5.5" },
  { id: "q2", name: "trinity-ui", member: "Trinity", role: "Frontend Dev", agentType: "general-purpose", status: "running", startedAt: "2026-10-21T07:00:10Z", activeTimeMs: 96000, model: "claude-sonnet-5" },
  { id: "q3", name: "morpheus-review", member: "Morpheus", role: "Reviewer", agentType: "code-review", status: "idle", startedAt: "2026-10-21T07:00:20Z", activeTimeMs: 71000, model: "gpt-5.6-sol" },
  { id: "q4", name: "oracle-docs", member: "Oracle", role: "Docs", agentType: "task", status: "completed", startedAt: "2026-10-21T07:00:30Z", completedAt: "2026-10-21T07:03:00Z", activeTimeMs: 150000, model: "claude-haiku-5.5" },
] };
const squadViews: [string, Dashboard["view"]][] = [
  ["Session", { type: "session", id: "s1", page: 0 }],
  ["Agents", { type: "agents", page: 0, sessionId: "s1" }],
  ["Neo", { type: "agent", page: 0, sessionId: "s1", agentId: "q1" }],
];
const squadDecks = squadViews.map(([label, view], i) => {
  squad.view = view;
  for (let n = 0; n < 40; n++) squad.tiles();
  return caption(34 + i * (deckWidth + 40), 44, label) + deck(squad.tiles(), 6, 30 + i * (deckWidth + 40), 64, undefined, `d${i}-`);
}).join("");
await shot("squad", page(deckWidth * 3 + 140, deckHeight + 100, squadDecks));
