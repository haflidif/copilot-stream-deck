import { cp, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const root = process.argv[2] ?? join(homedir(), ".copilot", "extensions");
const target = join(root, "copilot-stream-deck");
await mkdir(target, { recursive: true });
for (const name of ["extension.mjs", "bridge.mjs"]) {
  await cp(resolve("dist/extension", name), join(target, name));
}
console.log(`Installed the Copilot extension to ${target}. Reload extensions or restart open Copilot sessions.`);
