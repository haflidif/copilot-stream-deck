import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startBridge } from "../src/bridge/server.js";
import { BridgeClient } from "../src/plugin/client.js";
import type { Command } from "../src/shared/protocol.js";
import { snapshot } from "./fixtures.js";

test("selected session routes details and MCP to its bridge without changing the default", async () => {
  const directory = await mkdtemp(join(tmpdir(), "copilot-deck-routing-"));
  const commands: { id: string; command: Command }[] = [];
  const bridges: Awaited<ReturnType<typeof startBridge>>[] = [];
  try {
    for (const id of ["attached", "other"]) {
      bridges.push(await startBridge({
        snapshot: async () => {
          const data = snapshot();
          data.bridgeSessionId = id;
          data.details = { id, name: id, model: `${id}-model` };
          return data;
        },
        command: async (command) => { commands.push({ id, command }); },
      }, id, directory));
    }
    const client = new BridgeClient(directory);
    client.select("attached");
    assert.equal((await client.snapshot()).details?.model, "attached-model");
    assert.equal((await client.snapshot("other")).details?.model, "other-model");
    await client.command({ type: "setMcp", name: "example", enabled: false }, "other");
    assert.deepEqual(commands, [{ id: "other", command: { type: "setMcp", name: "example", enabled: false } }]);
    assert.equal((await client.snapshot()).bridgeSessionId, "attached");
    assert.equal((await client.snapshot("closed")).bridgeSessionId, "attached");
    await assert.rejects(client.command({ type: "setMcp", name: "example", enabled: true }, "closed"), /no longer running/);
    assert.equal(commands.length, 1);
  } finally {
    await Promise.all(bridges.map((bridge) => bridge.close()));
    await rm(directory, { recursive: true, force: true });
  }
});
