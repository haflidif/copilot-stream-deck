import { homedir } from "node:os";
import { join } from "node:path";

export function bridgeDirectory(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const base = platform === "win32" ? env.LOCALAPPDATA ?? join(home, "AppData", "Local")
    : platform === "darwin" ? join(home, "Library", "Application Support")
      : join(home, ".local", "share");
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
