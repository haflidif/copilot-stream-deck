import type { Tile, Icon } from "./dashboard.js";

const paths: Record<Icon, string> = {
  plus: '<path d="M48 32v32M32 48h32"/>',
  folder: '<path d="M24 36h19l7 7h23v28H24z"/>',
  chat: '<path d="M25 30h46v32H45L30 73V62h-5z"/>',
  star: '<path d="m48 25 7 16 18 2-14 12 4 18-15-9-16 9 4-18-13-12 18-2z"/>',
  grid: '<rect x="25" y="27" width="19" height="19" rx="3"/><rect x="52" y="27" width="19" height="19" rx="3"/><rect x="25" y="54" width="19" height="19" rx="3"/><rect x="52" y="54" width="19" height="19" rx="3"/>',
  mic: '<rect x="40" y="23" width="16" height="32" rx="8"/><path d="M31 44v4a17 17 0 0 0 34 0v-4M48 65v11M37 76h22"/>',
  back: '<path d="m45 31-19 17 19 17M27 48h29a15 15 0 0 1 15 15"/>',
  home: '<path d="m24 46 24-21 24 21M30 42v31h13V54h12v19h12V42"/>',
  left: '<path d="m57 27-22 22 22 22"/>',
  right: '<path d="m37 27 22 22-22 22"/>',
  refresh: '<path d="M69 42a23 23 0 1 0-1 22M69 24v20H49"/>',
  open: '<path d="M53 26h20v20M72 27 44 55M43 29H26v45h45V57"/>',
  check: '<path d="m25 49 15 16 32-35"/>',
  error: '<circle cx="48" cy="48" r="25"/><path d="M48 33v19M48 62v1"/>',
  session: '<rect x="27" y="29" width="42" height="34" rx="12"/><path d="M36 23v7M60 23v7M39 46h1M56 46h1M40 55h16"/>',
};

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
    return '<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144"><rect width="144" height="144" rx="13" fill="#0c1220"/></svg>';
  }
  const color = tile.activity === "error" ? "#ff747e" : tile.activity === "attention" ? "#ffc569" : "#66d9ff";
  const disabled = tile.disabled ? 0.42 : 1;
  const label = labelLines(tile.label).map((line, index) =>
    `<text x="72" y="${116 + index * 16}" text-anchor="middle" fill="#eef4ff" font-size="14" font-weight="600">${escapeXml(line)}</text>`).join("");
  let center: string;
  if (tile.activity === "working" && !reducedMotion) {
    const step = ((frame % 12) + 12) % 12;
    const count = [1, 2, 3, 4, 5, 6, 6, 5, 4, 3, 2, 1][step]!;
    center = Array.from({ length: 6 }, (_, i) => {
      const x = 59 + (i % 2) * 26;
      const y = 37 + Math.floor(i / 2) * 20;
      return `<circle cx="${x}" cy="${y}" r="5" fill="${color}" opacity="${i < count ? 1 : 0.12}"/>`;
    }).join("");
  } else if (tile.value) {
    const value = [...tile.value].slice(0, 32).join("");
    const size = value.length <= 4 ? 29 : value.length <= 8 ? 21 : 13;
    const lines = value.length > 13 ? labelLines(value) : [value];
    center = lines.map((line, index) => `<text x="72" y="${lines.length > 1 ? 53 + index * 19 : 64}" text-anchor="middle" fill="${color}" font-size="${size}" font-weight="600">${escapeXml(line)}</text>`).join("");
  } else {
    center = `<g transform="translate(24 10)" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">${tile.icon ? paths[tile.icon] : ""}</g>`;
  }
  const badge = tile.activity && tile.activity !== "working"
    ? tile.activity === "attention" ? `<text x="119" y="26" text-anchor="middle" fill="${color}" font-size="20" font-weight="700">?</text>`
      : tile.activity === "error" ? `<path d="m113 16 10 10m0-10-10 10" stroke="${color}" stroke-width="3"/>`
        : `<circle cx="119" cy="21" r="5" fill="${tile.activity === "idle" ? "#8194b1" : "#526077"}"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
<defs><linearGradient id="bg" x2="0" y2="1"><stop stop-color="#142039"/><stop offset="1" stop-color="#090e19"/></linearGradient></defs>
<rect width="144" height="144" rx="13" fill="url(#bg)"/>
<g opacity="${disabled}" font-family="Segoe UI, Arial, sans-serif">
<rect x="39" y="17" width="66" height="75" rx="16" fill="#203c56" stroke="${tile.selected ? color : "#29465e"}" stroke-width="2"/>
${center}${badge}${label}</g></svg>`;
}

export function tileDataUrl(tile: Tile, frame: number, reducedMotion: boolean): string {
  return `data:image/svg+xml;base64,${Buffer.from(renderTile(tile, frame, reducedMotion)).toString("base64")}`;
}
