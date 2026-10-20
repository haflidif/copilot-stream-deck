import { build } from "esbuild";
import { copyFile, mkdir, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { buildProfile } from "./build-profile.mjs";

// Release builds leave the source map out so the packed plugin stays small.
const release = process.argv.includes("--release");

await Promise.all(["plugin.js", "plugin.js.map", "plugin.mjs.map"].map((name) => rm(resolve("com.haflidif.copilot.sdPlugin/bin", name), { force: true })));
await Promise.all([
  build({
    entryPoints: ["src/plugin/plugin.ts"], outfile: "com.haflidif.copilot.sdPlugin/bin/plugin.mjs",
    bundle: true, platform: "node", format: "esm", target: "node20", sourcemap: !release,
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  }),
  build({
    entryPoints: ["src/bridge/entry.ts"], outfile: "dist/extension/bridge.mjs",
    bundle: true, platform: "node", format: "esm", target: "node20", sourcemap: false,
  }),
]);
await copyFile(resolve("extension/extension.mjs"), resolve("dist/extension/extension.mjs"));

// Generate small original raster icons without adding an image-tool dependency.
function png(size, mono = false) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * (size * 4 + 1) + 1 + x * 4;
      const dot = [0.32, 0.5, 0.68].some((cy) =>
        [0.38, 0.62].some((cx) => Math.hypot(x - size * cx, y - size * cy) < size * 0.055));
      raw.set(mono ? [255, 255, 255, dot ? 255 : 0] : dot ? [102, 217, 255, 255] : [20, 32, 57, 255], i);
    }
  }
  function chunk(type, data) {
    const name = Buffer.from(type);
    const bytes = Buffer.concat([name, data]);
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const result = Buffer.alloc(data.length + 12);
    result.writeUInt32BE(data.length);
    bytes.copy(result, 4);
    result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
    return result;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const images = resolve("com.haflidif.copilot.sdPlugin/imgs");
await mkdir(images, { recursive: true });
for (const [name, size, mono] of [["plugin", 256, false], ["category", 28, true], ["action", 20, true], ["key", 72, false]]) {
  await writeFile(resolve(images, `${name}.png`), png(size, mono));
  await writeFile(resolve(images, `${name}@2x.png`), png(size * 2, mono));
}
await buildProfile();
console.log("Built Stream Deck plugin and Copilot extension bridge.");
