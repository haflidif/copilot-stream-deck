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

test("a reloaded bridge on a new port is found again without a failed refresh", async () => {
  const directory = await mkdtemp(join(tmpdir(), "copilot-deck-reload-"));
  const provider = { snapshot: async () => snapshot(), command: async () => {} };
  let bridge = await startBridge(provider, "same", directory);
  try {
    const client = new BridgeClient(directory);
    await client.snapshot();
    await bridge.close();
    bridge = await startBridge(provider, "same", directory);
    assert.equal((await client.snapshot()).bridgeSessionId, snapshot().bridgeSessionId);
  } finally {
    await bridge.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("the active session's bridge wins over a newer warmup bridge", async () => {
  const directory = await mkdtemp(join(tmpdir(), "copilot-deck-warmup-"));
  const bridges: Awaited<ReturnType<typeof startBridge>>[] = [];
  try {
    for (const id of ["active", "warmup"]) {
      bridges.push(await startBridge({
        snapshot: async () => { const data = snapshot(); data.bridgeSessionId = id; return data; },
        command: async () => {},
      }, id, directory));
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    const client = new BridgeClient(directory);
    assert.equal((await client.snapshot()).bridgeSessionId, "warmup");
    client.follow("active");
    assert.equal((await client.snapshot()).bridgeSessionId, "active");
    client.follow("gone");
    assert.equal((await client.snapshot()).bridgeSessionId, "warmup");
  } finally {
    await Promise.all(bridges.map((bridge) => bridge.close()));
    await rm(directory, { recursive: true, force: true });
  }
});
