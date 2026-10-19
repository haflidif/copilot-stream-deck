import type { Tile, Icon } from "./dashboard.js";
import { icons } from "./icons.js";

const paths: Record<Icon, string> = Object.fromEntries(Object.entries(icons)
  .map(([key, list]) => [key, list.map((d) => `<path d="${d}"/>`).join("")])) as Record<Icon, string>;

export function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char]!);
}

export function labelLines(label: string): string[] {
  const chars = [...label.replace(/\s+/g, " ").trim()];
  if (chars.length <= 15) return [chars.join("")];
  let split = -1;
  for (let i = Math.min(chars.length, 16) - 1; i >= 3; i--) {
    if (chars[i] === " ") { split = i; break; }
    if ("-_./\\".includes(chars[i]!) && i < 15) { split = i + 1; break; }
  }
  if (split < 0) split = 15;
  const first = chars.slice(0, split).join("");
  const rest = chars.slice(split).join("").trim();
  return [first, [...rest].length > 15 ? [...rest].slice(0, 12).join("") + "..." : rest];
}

export function renderTile(tile: Tile, frame = 0, reducedMotion = false): string {
  if (!tile.label && !tile.icon && !tile.value && !tile.activity) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144"><rect width="144" height="144" rx="13" fill="#0d1117"/></svg>';
  }
  const color = tile.activity === "error" || tile.recording ? "#ff747e" : tile.activity === "attention" ? "#ffc569" : tile.activity === "ready" ? "#5be3a5" : "#b392f0";
  const disabled = tile.disabled ? 0.42 : 1;
  const label = labelLines(tile.label).map((line, index) =>
    `<text x="72" y="${116 + index * 16}" text-anchor="middle" fill="#e6edf3" font-size="14" font-weight="600">${escapeXml(line)}</text>`).join("");
  let center: string;
  if (tile.activity === "working" && !reducedMotion) {
    const step = ((frame % 12) + 12) % 12;
    const count = [1, 2, 3, 4, 5, 6, 6, 5, 4, 3, 2, 1][step]!;
    center = Array.from({ length: 6 }, (_, i) => {
      const x = 59 + (i % 2) * 26;
      const y = 37 + Math.floor(i / 2) * 20;
      return `<circle cx="${x}" cy="${y}" r="5" fill="${color}" opacity="${i < count ? 1 : 0.12}"/>`;
    }).join("");
  } else if (tile.gauge !== undefined && Number.isFinite(tile.gauge)) {
    const percent = Math.min(100, Math.max(0, tile.gauge));
    const ring = percent >= 85 ? "#ff747e" : percent >= 60 ? "#ffc569" : "#5be3a5";
    const circumference = 2 * Math.PI * 33;
    center = `<circle cx="72" cy="54" r="33" fill="none" stroke="#30363d" stroke-width="9"/>
<circle cx="72" cy="54" r="33" fill="none" stroke="${ring}" stroke-width="9" stroke-linecap="round" transform="rotate(-90 72 54)" stroke-dasharray="${(circumference * percent / 100).toFixed(1)} ${circumference.toFixed(1)}"/>
<text x="72" y="62" text-anchor="middle" fill="#e6edf3" font-size="22" font-weight="700">${percent.toFixed(0)}%</text>`;
  } else if (tile.value) {
    const value = [...tile.value].slice(0, 32).join("");
    const size = value.length <= 4 ? 29 : value.length <= 8 ? 21 : 13;
    const lines = value.length > 13 ? labelLines(value) : [value];
    center = lines.map((line, index) => `<text x="72" y="${lines.length > 1 ? 53 + index * 19 : 64}" text-anchor="middle" fill="${color}" font-size="${size}" font-weight="600">${escapeXml(line)}</text>`).join("");
  } else {
    center = `<g transform="translate(51 33) scale(1.75)" fill="${color}">${tile.icon ? paths[tile.icon] : ""}</g>`;
  }
  const badge = tile.activity && tile.activity !== "working"
    ? tile.activity === "attention" ? `<text x="119" y="26" text-anchor="middle" fill="${color}" font-size="20" font-weight="700">?</text>`
      : tile.activity === "error" ? `<path d="m113 16 10 10m0-10-10 10" stroke="${color}" stroke-width="3"/>`
        : tile.activity === "ready" ? `<path d="m112 21 5 5 9-10" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`
        : `<circle cx="119" cy="21" r="5" fill="${tile.activity === "idle" ? "#8b949e" : "#484f58"}"/>`
    : "";
  const pulse = (tile.activity === "attention" || tile.recording) && !reducedMotion && !tile.disabled
    ? (() => {
      const level = [0.15, 0.3, 0.5, 0.7, 0.9, 1, 1, 0.9, 0.7, 0.5, 0.3, 0.15][((frame % 12) + 12) % 12]!;
      return `<rect x="3" y="3" width="138" height="138" rx="12" fill="none" stroke="${color}" stroke-width="4" opacity="${level}"/>`;
    })()
    : tile.recording ? `<rect x="3" y="3" width="138" height="138" rx="12" fill="none" stroke="${color}" stroke-width="4"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
<defs><linearGradient id="bg" x2="0" y2="1"><stop stop-color="#161b22"/><stop offset="1" stop-color="#0d1117"/></linearGradient></defs>
<rect width="144" height="144" rx="13" fill="url(#bg)"/>${pulse}
<g opacity="${disabled}" font-family="Segoe UI, Arial, sans-serif">
${tile.gauge !== undefined && !(tile.activity === "working" && !reducedMotion) ? "" : `<rect x="39" y="17" width="66" height="75" rx="16" fill="#21262d" stroke="${tile.selected ? color : "#30363d"}" stroke-width="2"/>`}
${center}${badge}${label}</g></svg>`;
}

export function tileDataUrl(tile: Tile, frame: number, reducedMotion: boolean): string {
  return `data:image/svg+xml;base64,${Buffer.from(renderTile(tile, frame, reducedMotion)).toString("base64")}`;
}
