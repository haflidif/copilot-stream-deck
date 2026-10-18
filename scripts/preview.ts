import { mkdir, writeFile } from "node:fs/promises";
import { Dashboard } from "../src/plugin/dashboard.js";
import { renderTile } from "../src/plugin/render.js";
import { snapshot } from "../tests/fixtures.js";

const board = new Dashboard(async () => {}, async () => {});
board.snapshot = snapshot();
const views = [
  { title: "HOME", view: { type: "home", page: 0 } as const },
  { title: "LIVE SESSIONS", view: { type: "sessions", page: 0 } as const },
  { title: "ATTACHED SESSION", view: { type: "session", id: "attached", page: 0 } as const },
];
const panels = views.map(({ title, view }, panel) => {
  board.view = view;
  const tiles = board.tiles().map((tile, index) => `<g transform="translate(${(index % 5) * 104} ${Math.floor(index / 5) * 104}) scale(0.66)">${renderTile(tile, 5)}</g>`).join("");
  return `<g transform="translate(${24 + panel * 540} 90)"><text y="-18" fill="#9fb3ce" font-size="15" font-family="Segoe UI,Arial,sans-serif">${title}</text>${tiles}</g>`;
}).join("");
await mkdir("dist", { recursive: true });
await writeFile("dist/preview.svg", `<svg xmlns="http://www.w3.org/2000/svg" width="1650" height="450" viewBox="0 0 1650 450">
<rect width="1650" height="450" fill="#070b12"/>
<text x="24" y="34" fill="#edf4ff" font-size="23" font-family="Segoe UI,Arial,sans-serif">Copilot Companion / 15-key starter</text>
${panels}
<text x="24" y="433" fill="#8194b1" font-size="13" font-family="Segoe UI,Arial,sans-serif">Synthetic preview data. Voice and app-pinned chats are not connected. Actual device rendering requires hardware confirmation.</text>
</svg>`);
console.log("Wrote dist\\preview.svg");
