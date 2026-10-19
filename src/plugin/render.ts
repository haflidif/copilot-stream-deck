import type { Tile, Icon, Tone } from "./dashboard.js";
import { icons } from "./icons.js";
import { brands } from "./brands.js";

const paths: Record<Icon, string> = Object.fromEntries(Object.entries(icons)
  .map(([key, list]) => [key, list.map((d) => `<path d="${d}"/>`).join("")])) as Record<Icon, string>;

export function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char]!);
}

export function labelLines(label: string, max = 12): string[] {
  const chars = [...label.replace(/\s+/g, " ").trim()];
  if (chars.length <= max) return [chars.join("")];
  let split = -1;
  for (let i = Math.min(chars.length, max + 1) - 1; i >= 3; i--) {
    if (chars[i] === " ") { split = i; break; }
    if ("-_./\\".includes(chars[i]!) && i < max) { split = i + 1; break; }
  }
  if (split < 0) split = max;
  const first = chars.slice(0, split).join("");
  const rest = chars.slice(split).join("").trim();
  return [first, [...rest].length > max ? [...rest].slice(0, max - 1).join("") + "…" : rest];
}

/** Picks the largest label size that still shows the whole label, then truncates at the smallest. */
function fitLabel(label: string): { lines: string[]; size: number } {
  for (const [max, size] of [[12, 21], [14, 18]] as const) {
    const lines = labelLines(label, max);
    if (!lines.at(-1)!.endsWith("…")) return { lines, size };
  }
  return { lines: labelLines(label, 14), size: 18 };
}

/** Project colours the app offers. Unknown names get no strip rather than a guessed colour. */
const accents: Record<string, string> = {
  blue: "#58a6ff", green: "#3fb950", purple: "#bc8cff", orange: "#f0883e", red: "#f85149",
  yellow: "#d29922", pink: "#db61a2", teal: "#39c5cf", cyan: "#39c5cf", coral: "#f78166", gray: "#8b949e", grey: "#8b949e",
};

/** GitHub Primer colours per icon, used when no status or project colour applies. */
const iconColors: Partial<Record<Icon, string>> = {
  open: "#f0f6fc", home: "#f0f6fc", back: "#c9d1d9", left: "#c9d1d9", right: "#c9d1d9", refresh: "#c9d1d9",
  folder: "#54aeff", chat: "#3fb950", star: "#e3b341", pin: "#f78166", server: "#79c0ff", grid: "#a5d6ff",
  mic: "#56d4dd", check: "#3fb950", plus: "#3fb950", error: "#ff7b72", attention: "#ffc569", session: "#a371f7",
};

/** Copilot style gradients, top left to bottom right. */
const iconGradients: Partial<Record<Icon, string[]>> = {
  copilot: ["#c297ff", "#8957e5", "#58a6ff"],
  sparkle: ["#ffd33d", "#f778ba", "#a371f7"],
};

function gradient(id: string, stops: string[]): { fill: string; defs: string } {
  const stopTags = stops.map((stop, index) => `<stop offset="${index / (stops.length - 1)}" stop-color="${stop}"/>`).join("");
  return { fill: `url(#${id})`, defs: `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">${stopTags}</linearGradient></defs>` };
}

function iconFill(icon: Icon): { fill: string; defs: string } {
  const stops = iconGradients[icon];
  return stops ? gradient(`icon-${icon}`, stops) : { fill: iconColors[icon] ?? "#b392f0", defs: "" };
}

const tones: Record<Exclude<Tone, "copilot">, string> = { blue: "#79c0ff", gold: "#e3b341", green: "#3fb950", muted: "#8b949e" };

function toneFill(tone: Tone): { fill: string; defs: string } {
  return tone === "copilot" ? gradient("value-copilot", iconGradients.copilot!) : { fill: tones[tone], defs: "" };
}

/** Provider logos (see brands.ts). Single-colour marks are drawn in white on the dark tile. */
function providerBadge(provider: string, tall: boolean): string | undefined {
  if (!Object.hasOwn(brands, provider)) return;
  const size = tall ? 60 : 68;
  const top = tall ? 14 : 18;
  const scale = (size * 0.72) / 24;
  const inset = (size - 24 * scale) / 2;
  return `<rect x="${72 - size / 2}" y="${top}" width="${size}" height="${size}" rx="16" fill="#ffffff" fill-opacity="0.08"/>`
    + `<g transform="translate(${(72 - size / 2 + inset).toFixed(2)} ${(top + inset).toFixed(2)}) scale(${scale.toFixed(4)})" fill="#ffffff" fill-rule="evenodd">${brands[provider]}</g>`;
}

export function renderTile(tile: Tile, frame = 0, reducedMotion = false): string {
  if (!tile.label && !tile.icon && !tile.value && !tile.activity) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144"><rect width="144" height="144" rx="13" fill="#0d1117"/></svg>';
  }
  const accent = tile.accent && Object.hasOwn(accents, tile.accent) ? accents[tile.accent] : undefined;
  const color = tile.activity === "error" || tile.recording ? "#ff747e" : tile.activity === "attention" ? "#ffc569" : tile.activity === "ready" ? "#5be3a5"
    : tile.activity === "working" ? "#b392f0" : accent ?? "#b392f0";
  const disabled = tile.disabled ? 0.42 : 1;
  const fitted = fitLabel(tile.label);
  const label = fitted.lines.map((line, index) =>
    `<text x="72" y="${(fitted.lines.length > 1 ? 108 : 122) + index * (fitted.size + 3)}" text-anchor="middle" fill="#e6edf3" font-size="${fitted.size}" font-weight="700">${escapeXml(line)}</text>`).join("");
  // Two-line labels push the label up, so the art above them shrinks a little.
  const tall = fitted.lines.length > 1;
  let center: string;
  if (tile.activity === "working" && !reducedMotion) {
    const step = ((frame % 12) + 12) % 12;
    const count = [1, 2, 3, 4, 5, 6, 6, 5, 4, 3, 2, 1][step]!;
    center = Array.from({ length: 6 }, (_, i) => {
      const x = 56 + (i % 2) * 32;
      const y = (tall ? 22 : 26) + Math.floor(i / 2) * (tall ? 22 : 26);
      return `<circle cx="${x}" cy="${y}" r="8" fill="${color}" opacity="${i < count ? 1 : 0.12}"/>`;
    }).join("");
  } else if (tile.provider && providerBadge(tile.provider, tall)) {
    center = providerBadge(tile.provider, tall)!;
  } else if (tile.gauge !== undefined && Number.isFinite(tile.gauge)) {
    const percent = Math.min(100, Math.max(0, tile.ring !== undefined && Number.isFinite(tile.ring) ? tile.ring : tile.gauge));
    const ring = percent >= 85 ? "#ff747e" : percent >= 60 ? "#ffc569" : "#5be3a5";
    const r = tall ? 30 : 36;
    const cy = tall ? 46 : 52;
    const circumference = 2 * Math.PI * r;
    center = `<circle cx="72" cy="${cy}" r="${r}" fill="none" stroke="#30363d" stroke-width="10"/>
<circle cx="72" cy="${cy}" r="${r}" fill="none" stroke="${ring}" stroke-width="10" stroke-linecap="round" transform="rotate(-90 72 ${cy})" stroke-dasharray="${(circumference * percent / 100).toFixed(1)} ${circumference.toFixed(1)}"/>
<text x="72" y="${cy + 10}" text-anchor="middle" fill="#e6edf3" font-size="${tall ? 24 : 28}" font-weight="700">${percent.toFixed(0)}%</text>`;
  } else if (tile.value) {
    const value = [...tile.value].slice(0, 32).join("");
    const length = [...value].length;
    const lines = length > 10 ? labelLines(value, 12) : [value];
    // Long single words shrink to fit the key instead of being clipped (bold glyphs are about 0.5em wide).
    const size = lines.length > 1 ? 22 : length <= 4 ? 46 : length <= 7 ? 34 : Math.min(26, Math.floor(260 / length));
    const toned = tile.tone && !tile.activity && !tile.recording && !accent ? toneFill(tile.tone) : { fill: color, defs: "" };
    center = toned.defs + lines.map((line, index) => `<text x="72" y="${lines.length > 1 ? 44 + index * 26 : (tall ? 56 : 62) + size * 0.1}" text-anchor="middle" fill="${toned.fill}" font-size="${size}" font-weight="700">${escapeXml(line)}</text>`).join("");
  } else {
    const scale = tall ? 2.5 : 2.9;
    const offset = 72 - 12 * scale;
    const branded = tile.icon && !tile.activity && !tile.recording && !accent ? iconFill(tile.icon) : { fill: color, defs: "" };
    center = `${branded.defs}<g transform="translate(${offset} ${tall ? 14 : 16}) scale(${scale})" fill="${branded.fill}">${tile.icon ? paths[tile.icon] : ""}</g>`;
  }
  const badge = tile.activity && tile.activity !== "working"
    ? tile.activity === "attention" ? `<circle cx="122" cy="22" r="14" fill="${color}"/><text x="122" y="31" text-anchor="middle" fill="#0d1117" font-size="24" font-weight="800">?</text>`
      : tile.activity === "error" ? `<circle cx="122" cy="22" r="14" fill="${color}"/><path d="m116 16 12 12m0-12-12 12" stroke="#0d1117" stroke-width="3.5" stroke-linecap="round"/>`
        : tile.activity === "ready" ? `<circle cx="122" cy="22" r="14" fill="${color}"/><path d="m115 22 5 5 9-10" fill="none" stroke="#0d1117" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`
        : `<circle cx="124" cy="20" r="7" fill="${tile.activity === "idle" ? "#8b949e" : "#484f58"}"/>`
    : "";
  const count = tile.children && tile.children > 0 ? (tile.children > 9 ? "9+" : String(tile.children)) : "";
  const group = count
    ? `<rect x="8" y="10" width="${count.length > 1 ? 46 : 38}" height="26" rx="13" fill="#e6edf3"/><text x="${count.length > 1 ? 31 : 27}" y="29" text-anchor="middle" fill="#0d1117" font-size="18" font-weight="800">+${count}</text>`
    : tile.nested ? `<path d="M16 14v14h14" fill="none" stroke="#8b949e" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="m25 22 6 6-6 6" fill="none" stroke="#8b949e" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`
      : "";
  const pulse = (tile.activity === "attention" || tile.recording) && !reducedMotion && !tile.disabled
    ? (() => {
      const level = [0.15, 0.3, 0.5, 0.7, 0.9, 1, 1, 0.9, 0.7, 0.5, 0.3, 0.15][((frame % 12) + 12) % 12]!;
      return `<rect x="3" y="3" width="138" height="138" rx="12" fill="none" stroke="${color}" stroke-width="4" opacity="${level}"/>`;
    })()
    : tile.flash && !tile.disabled
      ? `<rect x="3" y="3" width="138" height="138" rx="12" fill="none" stroke="#5be3a5" stroke-width="5" opacity="${reducedMotion ? 1 : [1, 0.85, 0.6, 0.4, 0.6, 0.85][((frame % 6) + 6) % 6]}"/>`
    : tile.recording ? `<rect x="3" y="3" width="138" height="138" rx="12" fill="none" stroke="${color}" stroke-width="4"/>`
      : tile.selected ? `<rect x="2.5" y="2.5" width="139" height="139" rx="12" fill="none" stroke="${color}" stroke-width="3"/>` : "";
  const strip = accent ? `<rect width="144" height="12" fill="${accent}" clip-path="url(#tile)"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
<defs><linearGradient id="bg" x2="0" y2="1"><stop stop-color="#1c2230"/><stop offset="1" stop-color="#0d1117"/></linearGradient><clipPath id="tile"><rect width="144" height="144" rx="13"/></clipPath></defs>
<rect width="144" height="144" rx="13" fill="url(#bg)"/>${strip}${pulse}
<g opacity="${disabled}" font-family="Segoe UI, Arial, sans-serif">
${center}${badge}${group}${label}</g></svg>`;
}

export function tileDataUrl(tile: Tile, frame: number, reducedMotion: boolean): string {
  return `data:image/svg+xml;base64,${Buffer.from(renderTile(tile, frame, reducedMotion)).toString("base64")}`;
}
