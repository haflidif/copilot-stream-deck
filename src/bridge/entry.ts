import { AppProvider } from "./provider.js";
import { startBridge } from "./server.js";
import type { JoinedSession } from "./app-tools.js";

export async function attachBridge(session: JoinedSession) {
  const provider = new AppProvider(session);
  const bridge = await startBridge(provider, session.sessionId);
  return {
    async close() {
      provider.dispose();
      await bridge.close();
    },
  };
}
