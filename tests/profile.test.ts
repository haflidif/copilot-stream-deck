import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { TextWriter, Uint8ArrayReader, ZipReader } from "@zip.js/zip.js";

test("bundled profile configures all 15 keys without user settings or automatic switching", async () => {
  const plugin = resolve("com.haflidif.copilot.sdPlugin");
  const manifest = JSON.parse(await readFile(resolve(plugin, "manifest.json"), "utf8"));
  assert.equal(manifest.Profiles.length, 1);
  const profile = manifest.Profiles[0];
  assert.equal(profile.DeviceType, 0);
  assert.equal(profile.AutoInstall, true);
  assert.equal(profile.DontAutoSwitchWhenInstalled, true);
  assert.equal(profile.Readonly, false);
  const bytes = await readFile(resolve(plugin, `${profile.Name}.streamDeckProfile`));
  assert.deepEqual(await readFile(resolve("dist/copilot-companion.streamDeckProfile")), bytes);
  const reader = new ZipReader(new Uint8ArrayReader(bytes));
  try {
    const entries = await reader.getEntries();
    assert.equal(entries.length, 2, "Only clean profile manifests should be bundled");
    const rootEntry = entries.find((entry) => /^[^/]+\.sdProfile\/manifest\.json$/.test(entry.filename));
    assert.ok(rootEntry && !rootEntry.directory);
    const root = JSON.parse(await rootEntry.getData(new TextWriter()));
    assert.equal(root.Name, "Copilot Companion");
    assert.equal(root.Version, "2.0");
    assert.deepEqual(root.Device, { Model: "20GAA9901", UUID: "" });
    assert.deepEqual(root.Pages.Pages, [root.Pages.Current]);
    assert.equal(root.Pages.Default, root.Pages.Current);
    // Decode the directory name independently to check that it matches the page UUID.
    const pageEntry = entries.find((entry) => entry.filename.includes("/Profiles/"));
    assert.ok(pageEntry && !pageEntry.directory);
    const folder = pageEntry.filename.split("/")[2]!;
    assert.match(folder, /^[0-9A-TVW]{26}Z$/);
    const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTVW";
    const bits = [...folder.slice(0, -1)].map((char) => alphabet.indexOf(char).toString(2).padStart(5, "0")).join("");
    const hex = Array.from({ length: 32 }, (_, i) => parseInt(bits.slice(i * 4, i * 4 + 4), 2).toString(16)).join("");
    assert.equal(hex, root.Pages.Current.replaceAll("-", ""));
    const page = JSON.parse(await pageEntry.getData(new TextWriter()));
    assert.equal(page.Controllers.length, 1);
    assert.equal(page.Controllers[0].Type, "Keypad");
    const actions = page.Controllers[0].Actions;
    assert.deepEqual(Object.keys(actions).sort(), Array.from({ length: 15 }, (_, i) => `${i % 5},${Math.floor(i / 5)}`).sort());
    const ids = new Set();
    for (const action of Object.values(actions) as Array<{
      ActionID: string; UUID: string; Settings: object; State: number; States: object[];
    }>) {
      assert.equal(action.UUID, manifest.Actions[0].UUID);
      assert.deepEqual(action.Settings, {});
      assert.equal(action.State, 0);
      assert.deepEqual(action.States, [{ ShowTitle: false, Title: "" }]);
      assert.match(action.ActionID, /^[0-9a-f-]{36}$/);
      ids.add(action.ActionID);
    }
    assert.equal(ids.size, 15);
  } finally {
    await reader.close();
  }
});
