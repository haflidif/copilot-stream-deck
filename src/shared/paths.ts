import { homedir } from "node:os";
import { join } from "node:path";

export function bridgeDirectory(): string {
  const base = process.platform === "win32"
    ? process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local")
    : join(homedir(), ".local", "share");
  return join(base, "CopilotStreamDeck", "bridges");
}
