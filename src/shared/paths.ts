import { homedir } from "node:os";
import { join } from "node:path";

export function bridgeDirectory(): string {
  const base = process.platform === "win32"
    ? process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local")
    : join(homedir(), ".local", "share");
  return join(base, "CopilotStreamDeck", "bridges");
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
