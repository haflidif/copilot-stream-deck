// Renders docs/images/navigation.gif: a short walk through the deck using the real Dashboard and renderer with demo data.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import gifenc from "gifenc";
import { Dashboard } from "../src/plugin/dashboard.js";
import { ambientFrames } from "../src/plugin/render.js";
import { deck, deckHeight, deckWidth, demo, page } from "./demo.js";

const { GIFEncoder, applyPalette, quantize } = gifenc;
const tickMs = 125, width = 720, margin = 20;
let now = 1_000_000, frame = 0;
const board = new Dashboard(async () => {}, async () => {});
board.now = () => now;
board.snapshot = demo();

const gif = GIFEncoder();
let count = 0;
function capture(pressed?: number): void {
  const tiles = board.tiles();
  const svg = page(deckWidth + margin * 2, deckHeight + margin * 2, deck(tiles, frame, margin, margin, pressed));
  const image = new Resvg(svg, { fitTo: { mode: "width", value: width }, font: { loadSystemFonts: true } }).render();
  const rgba = new Uint8Array(image.pixels);
  const palette = quantize(rgba, 256);
  gif.writeFrame(applyPalette(rgba, palette), image.width, image.height, { palette, delay: tickMs, repeat: 0 });
  now += tickMs;
  frame = (frame + 1) % ambientFrames;
  count++;
}

// The Home key sits bottom middle; on other pages it shows the page title instead of "Home".
const home = 12;
const hold = (seconds: number) => { for (let i = Math.round(seconds * 1000 / tickMs); i > 0; i--) capture(); };
async function tap(label: string | number): Promise<void> {
  const index = typeof label === "number" ? label : board.tiles().findIndex((tile) => tile?.label === label);
  if (index < 0) throw new Error(`No key labelled ${label}`);
  capture(index);
  capture(index);
  await board.press(index);
}

type Activity = "working" | "attention" | "idle";
function set(changes: Record<string, Activity>): void {
  board.snapshot = { ...board.snapshot!, sessions: board.snapshot!.sessions.map((row) => row.id in changes ? { ...row, activity: changes[row.id]! } : row) };
}

// Everything is quiet, so the mascot sleeps.
set({ s1: "idle", s2: "idle", s3: "idle", s4: "idle", s6: "idle" });
board.tiles();
hold(2.5);
// Work starts and the mascot wakes up.
set({ s1: "working", s3: "working" });
hold(2.5);
// A session needs you: Psst!
set({ s2: "attention" });
hold(2);
await tap("Psst!");
hold(1.5);
await tap(home);
// You answered, so it gets back to work.
set({ s2: "working" });
hold(1.5);
await tap("Projects");
hold(1.5);
await tap("Web shop");
hold(1.5);
await tap(home);
hold(0.5);
await tap("This session");
hold(2);
// Subagents working for this session, then one agent's details.
await tap("Agents");
hold(2.5);
await tap("API tester");
hold(2);
await tap(home);
hold(1);
// Everything finishes: confetti, and the mascot goes back to sleep.
set({ s1: "idle", s2: "idle", s3: "idle", s6: "idle" });
hold(Dashboard.confettiMs / 1000 + 1.5);
gif.finish();
const out = resolve("docs/images/navigation.gif");
await mkdir(resolve("docs/images"), { recursive: true });
await writeFile(out, gif.bytes());
console.log(`Wrote docs\\images\\navigation.gif (${count} frames, ${Math.round(gif.bytes().length / 1024)} KB)`);
