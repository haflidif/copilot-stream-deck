import { joinSession } from "@github/copilot-sdk/extension";
import { attachBridge } from "./bridge.mjs";

const session = await joinSession();
const bridge = await attachBridge(session);

async function stop() {
  try {
    await bridge.close();
    process.exit(0);
  } catch (error) {
    console.error("Stream Deck bridge shutdown failed:", error);
    process.exit(1);
  }
}
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
