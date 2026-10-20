import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";

export async function buildProfile() {
  const plugin = resolve("com.haflidif.copilot.sdPlugin");
  const manifest = JSON.parse(await readFile(resolve(plugin, "manifest.json"), "utf8"));
  const action = manifest.Actions.find((entry) => entry.UUID === `${manifest.UUID}.dashboard`);
  if (!action) throw new Error("Dashboard action is missing from the plugin manifest.");
  const profile = manifest.Profiles.find((entry) => entry.DeviceType === 0);
  if (!profile) throw new Error("15-key profile is missing from the plugin manifest.");

  // Keep distribution IDs stable, and never export a user's device or connection settings.
  const root = "71EA8F60-2C37-4B29-9083-E3B574DF628A.sdProfile";
  const page = "b36ad7b1-d682-4aa8-a598-9be74ab4da52";
  // Stream Deck stores page UUIDs as base32 with a custom alphabet and trailing Z.
  const folder = (page.replaceAll("-", "") + "000").match(/.{5}/g)
    .map((part) => parseInt(part, 16).toString(32).padStart(4, "0"))
    .join("").slice(0, 26).toUpperCase().replaceAll("V", "W").replaceAll("U", "V") + "Z";
  const actions = Object.fromEntries(Array.from({ length: 15 }, (_, index) => [
    `${index % 5},${Math.floor(index / 5)}`,
    {
      ActionID: `92023e4d-87bc-4e90-82a4-${String(index + 1).padStart(12, "0")}`,
      LinkedTitle: true,
      Name: action.Name,
      UUID: action.UUID,
      Settings: {},
      State: 0,
      States: [{ ShowTitle: false, Title: "" }],
    },
  ]));
  const files = {
    [`${root}/manifest.json`]: {
      Device: { Model: "20GAA9901", UUID: "" },
      Name: "Copilot Companion",
      Pages: { Current: page, Default: page, Pages: [page] },
      Version: "2.0",
    },
    [`${root}/Profiles/${folder}/manifest.json`]: {
      Controllers: [{ Actions: actions, Type: "Keypad" }],
      Icon: "",
      Name: "",
    },
  };
  const writer = new ZipWriter(new Uint8ArrayWriter());
  for (const [name, contents] of Object.entries(files)) {
    await writer.add(name, new TextReader(JSON.stringify(contents)), {
      lastModDate: new Date("2026-01-01T00:00:00Z"),
      extendedTimestamp: false,
      useWebWorkers: false,
    });
  }
  const output = resolve(plugin, `${profile.Name}.streamDeckProfile`);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, await writer.close());
  await mkdir(resolve("dist"), { recursive: true });
  await copyFile(output, resolve("dist/copilot-companion.streamDeckProfile"));
  console.log("Built bundled 15-key Copilot Companion profile.");
}
