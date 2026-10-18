import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSavedDetails } from "../src/plugin/history.js";

const line = (type: string, data: unknown, timestamp = "2026-10-18T10:00:00.000Z") => JSON.stringify({ type, data, timestamp });

test("saved details use the newest usage and credits from session history", async () => {
  const root = await mkdtemp(join(tmpdir(), "copilot-deck-history-"));
  try {
    await mkdir(join(root, "abc-1"));
    const filler = line("assistant.message", { content: "x".repeat(400 * 1024) });
    await writeFile(join(root, "abc-1", "events.jsonl"), [
      line("session.usage_record", { usage: { model: "old-model", inputTokens: 1, maxPromptTokens: 10 } }),
      line("session.shutdown", { accountingSnapshot: { totalNanoAiu: 1e9, aiCreditsStatus: "complete" } }),
      line("session.usage_checkpoint", { totalNanoAiu: 2.5e9 }),
      filler,
      line("session.usage_record", { usage: { model: "gpt-6-luna", inputTokens: 68000, maxPromptTokens: 272000 } }),
      filler,
      line("session.model_change", { newModel: "gpt-5.6-sol", reasoningEffort: "high", contextTier: "default" }),
      line("hook.end", {}, "2026-10-18T12:00:00.000Z"),
      line("session.shutdown", { accountingSnapshot: { totalNanoAiu: 4.2e9, aiCreditsStatus: "complete" } }, "2026-10-18T11:00:00.000Z"),
    ].join("\n") + "\n");

    const details = await readSavedDetails("abc-1", "Blog", root);
    assert.deepEqual(details, {
      id: "abc-1", name: "Blog", source: "saved", updatedAt: "2026-10-18T11:00:00.000Z",
      model: "gpt-5.6-sol", reasoning: "high", contextTier: "default",
      contextLimit: 272000, contextPercent: 25, aiCredits: 4.2, creditsStatus: "complete",
    });
    assert.equal(await readSavedDetails("missing", "None", root), undefined);
    await assert.rejects(readSavedDetails("..\\x", "Bad", root), /Invalid session id/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
