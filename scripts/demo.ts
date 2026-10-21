// Made-up demo data and deck drawing shared by the README screenshot and GIF scripts.
import { renderTile } from "../src/plugin/render.js";
import type { Tile } from "../src/plugin/dashboard.js";
import type { Snapshot } from "../src/shared/protocol.js";

export function demo(): Snapshot {
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
    agents: [
      { id: "a1", name: "Frontend scout", agentType: "explore", status: "running", startedAt: "2026-10-21T07:00:00Z", activeTimeMs: 128000, model: "claude-haiku-5.5" },
      { id: "a2", name: "API tester", agentType: "task", status: "running", startedAt: "2026-10-21T07:00:10Z", activeTimeMs: 84000, model: "gpt-5.6-luna" },
      { id: "a3", name: "Docs writer", agentType: "general-purpose", status: "idle", startedAt: "2026-10-21T07:00:20Z", activeTimeMs: 95000, model: "claude-sonnet-5" },
      { id: "a4", name: "Security review", agentType: "security-review", status: "completed", startedAt: "2026-10-21T07:00:30Z", completedAt: "2026-10-21T07:03:00Z", activeTimeMs: 150000, model: "gpt-5.6-sol" },
    ],
    capabilities: {
      projects: { available: true }, sessions: { available: true }, openSession: { available: true },
      newChat: { available: true }, details: { available: true }, mcp: { available: true },
      voice: { available: true }, appPins: { available: true }, model: { available: true }, agents: { available: true },
    },
    errors: [],
  };
}

export const key = 144, gap = 18, pad = 36;
export const deckWidth = pad * 2 + key * 5 + gap * 4;
export const deckHeight = pad * 2 + key * 3 + gap * 2;

/** Places a key SVG inline with its ids made unique, so renderers that skip fonts inside nested images still draw the labels. */
export function inline(svg: string, prefix: string, x: number, y: number): string {
  return svg
    .replace(/id="([^"]+)"/g, `id="${prefix}$1"`)
    .replace(/url\(#([^)]+)\)/g, `url(#${prefix}$1)`)
    .replace(/href="#([^"]+)"/g, `href="#${prefix}$1"`)
    .replace(/<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="144" height="144"( viewBox="0 0 144 144")?/, `<svg x="${x}" y="${y}" width="${key}" height="${key}" viewBox="0 0 144 144"`);
}

/** Draws a 15-key deck. `pressed` darkens one key and outlines it, like a finger pushing it down. */
export function deck(tiles: Tile[], frame: number, x = 0, y = 0, pressed?: number): string {
  const keys = tiles.slice(0, 15).map((tile, index) => {
    const left = pad + (index % 5) * (key + gap), top = pad + Math.floor(index / 5) * (key + gap);
    const image = inline(renderTile(tile, frame, false, index), `k${index}-`, left, top);
    if (index !== pressed) return image;
    const c = key / 2;
    return `<g transform="translate(${left + c} ${top + c}) scale(0.92) translate(${-left - c} ${-top - c})">${image}` +
      `<rect x="${left}" y="${top}" width="${key}" height="${key}" rx="18" fill="#000" fill-opacity="0.25" stroke="#ffffff" stroke-opacity="0.85" stroke-width="5"/></g>`;
  }).join("");
  return `<g transform="translate(${x} ${y})"><rect width="${deckWidth}" height="${deckHeight}" rx="28" fill="#05070b" stroke="#232a36" stroke-width="2"/>${keys}</g>`;
}

export function page(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#0d1117"/>${body}</svg>`;
}

export const caption = (x: number, y: number, text: string) =>
  `<text x="${x}" y="${y}" fill="#c9d1d9" font-family="Segoe UI, Arial, sans-serif" font-size="22" font-weight="600">${text}</text>`;
