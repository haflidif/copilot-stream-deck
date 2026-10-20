// Renders README screenshots from made-up demo data, so no real project or session names end up in the repo.
// Windows only: uses Microsoft Edge in headless mode to turn the SVGs into PNGs.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Dashboard } from "../src/plugin/dashboard.js";
import { renderTile } from "../src/plugin/render.js";
import type { Tile } from "../src/plugin/dashboard.js";
import type { Snapshot } from "../src/shared/protocol.js";

const edge = ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"].find(existsSync);
if (!edge) throw new Error("Microsoft Edge was not found.");

function demo(): Snapshot {
  return {
    version: 1, capturedAt: new Date().toISOString(), bridgeSessionId: "s1",
    projects: [
      { id: "web", name: "Web shop", accent: "#58a6ff" },
      { id: "api", name: "Orders API", accent: "#5be3a5" },
      { id: "infra", name: "Infra", accent: "#f2cc60" },
      { id: "docs", name: "Docs site", accent: "#c297ff" },
    ],
    sessions: [
      { id: "s1", name: "Checkout redesign", projectId: "web", kind: "session", activity: "working", pinned: true },
      { id: "s2", name: "Fix flaky tests", projectId: "api", kind: "session", activity: "attention" },
      { id: "s3", name: "Add rate limits", projectId: "api", kind: "session", activity: "working" },
      { id: "s4", name: "Terraform upgrade", projectId: "infra", kind: "session", activity: "ready" },
      { id: "s5", name: "Search page", projectId: "web", kind: "session", activity: "idle" },
      { id: "s6", name: "Write tests", projectId: "web", kind: "session", activity: "working", parentId: "s1" },
      { id: "s7", name: "Getting started", projectId: "docs", kind: "session", activity: "idle" },
      { id: "c1", name: "Regex help", kind: "chat", activity: "idle" },
    ],
    details: { id: "s1", name: "Checkout redesign", model: "claude-sonnet-5", reasoning: "high", contextPercent: 62, contextLimit: 200000, aiCredits: 4.5, creditsStatus: "complete" },
    mcp: [{ name: "github", enabled: true, status: "connected" }, { name: "playwright", enabled: false, status: "disabled" }],
    capabilities: {
      projects: { available: true }, sessions: { available: true }, openSession: { available: true },
      newChat: { available: true }, details: { available: true }, mcp: { available: true },
      voice: { available: true }, appPins: { available: true }, model: { available: true },
    },
    errors: [],
  };
}

const key = 144, gap = 18, pad = 36;
const deckWidth = pad * 2 + key * 5 + gap * 4;
const deckHeight = pad * 2 + key * 3 + gap * 2;

function deck(tiles: Tile[], frame: number, x = 0, y = 0): string {
  const keys = tiles.slice(0, 15).map((tile, index) => {
    const svg = renderTile(tile, frame, false, index);
    return `<image x="${pad + (index % 5) * (key + gap)}" y="${pad + Math.floor(index / 5) * (key + gap)}" width="${key}" height="${key}" href="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}"/>`;
  }).join("");
  return `<g transform="translate(${x} ${y})"><rect width="${deckWidth}" height="${deckHeight}" rx="28" fill="#05070b" stroke="#232a36" stroke-width="2"/>${keys}</g>`;
}

function page(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#0d1117"/>${body}</svg>`;
}

const caption = (x: number, y: number, text: string) =>
  `<text x="${x}" y="${y}" fill="#c9d1d9" font-family="Segoe UI, Arial, sans-serif" font-size="22" font-weight="600">${text}</text>`;

const out = resolve("docs/images");
const work = resolve("dist/screens");
await mkdir(out, { recursive: true });
await mkdir(work, { recursive: true });

async function shot(name: string, svg: string, width: number, height: number): Promise<void> {
  const file = resolve(work, `${name}.svg`);
  await writeFile(file, svg);
  execFileSync(edge!, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--screenshot=${resolve(out, `${name}.png`)}`,
    `--window-size=${width},${height}`, `file:///${file.replace(/\\/g, "/")}`], { stdio: "ignore" });
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
  await shot(name, page(deckWidth + 40, deckHeight + 40, deck(settled(), 6, 20, 20)), deckWidth + 40, deckHeight + 40);
}

// Hero image: Home and a session side by side.
board.view = { type: "home", page: 0 };
const home = settled();
board.view = { type: "session", id: "s1", page: 0 };
const session = settled();
const heroWidth = deckWidth * 2 + 100, heroHeight = deckHeight + 100;
await shot("hero", page(heroWidth, heroHeight,
  caption(34, 44, "Home") + deck(home, 6, 30, 64) + caption(deckWidth + 74, 44, "Session") + deck(session, 6, deckWidth + 70, 64)), heroWidth, heroHeight);

// Copilot moods and the confetti burst, as strips of single keys.
const strip = (items: [string, Tile, number][]) => {
  const width = items.length * (key + 30) + 30;
  return { width, svg: page(width, key + 80, items.map(([label, tile, frame], i) =>
    `<text x="${30 + i * (key + 30) + key / 2}" y="34" text-anchor="middle" fill="#8b949e" font-family="Segoe UI, Arial, sans-serif" font-size="16">${label}</text>` +
    `<image x="${30 + i * (key + 30)}" y="50" width="${key}" height="${key}" href="data:image/svg+xml;base64,${Buffer.from(renderTile(tile, frame, false)).toString("base64")}"/>`).join("")) };
};
const moods = strip([
  ["Working", { label: "Working", busy: 2 }, 0],
  ["Sleeping", { label: "Sleeping", busy: 0 }, 0],
  ["Needs you", { label: "Psst!", busy: 1, mood: { alert: true } }, 2],
  ["Context nearly full", { label: "Working", busy: 1, mood: { sweat: true } }, 20],
]);
await shot("moods", moods.svg, moods.width, key + 80);
const finished: Tile = { label: "Finished", icon: "check", activity: "ready", flash: true };
const confetti = strip([0.05, 0.13, 0.4, 0.5, 0.75, 0.85].map((p, i) => [`${(p * Dashboard.confettiMs / 1000).toFixed(1)} s`, { ...finished, confetti: p }, i] as [string, Tile, number]));
await shot("confetti", confetti.svg, confetti.width, key + 80);
