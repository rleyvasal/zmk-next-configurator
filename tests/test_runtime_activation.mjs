import { runtimeOverlayIsLive, waitForRuntimeStatus } from "../src/connection/runtime-activation.js";

if (runtimeOverlayIsLive({ activeGeneration: 53, pendingGeneration: 54 }, 54)) {
  throw new Error("pending generation is not live");
}
if (!runtimeOverlayIsLive({ activeGeneration: 54, pendingGeneration: 0 }, 54)) {
  throw new Error("active generation should be live");
}
if (!runtimeOverlayIsLive({ activeGeneration: 54, pendingGeneration: 54 }, 54)) {
  throw new Error("pending equal to active is live");
}
if (runtimeOverlayIsLive({ activeGeneration: 53, pendingGeneration: 54 }, 0)) {
  throw new Error("idle wait must not proceed while a generation is pending");
}
if (!runtimeOverlayIsLive({ activeGeneration: 53, pendingGeneration: 0 }, 0)) {
  throw new Error("cleared pending is idle");
}
if (runtimeOverlayIsLive({ activeGeneration: 53, pendingGeneration: 0 }, 54)) {
  throw new Error("older active generation is not the wanted one");
}

let polls = 0;
const waited = await waitForRuntimeStatus(
  async () => {
    polls += 1;
    return polls < 3
      ? { activeGeneration: 1, pendingGeneration: 2 }
      : { activeGeneration: 2, pendingGeneration: 0 };
  },
  { wantedGeneration: 2, intervalMs: 1, timeoutMs: 200 }
);
if (!waited.ok || waited.status.activeGeneration !== 2 || polls !== 3) {
  throw new Error(`wait ${JSON.stringify(waited)} polls ${polls}`);
}

const timedOut = await waitForRuntimeStatus(
  async () => ({ activeGeneration: 1, pendingGeneration: 2 }),
  { wantedGeneration: 2, intervalMs: 1, timeoutMs: 10 }
);
if (timedOut.ok || !timedOut.timeout) throw new Error("timeout should fail");

console.log("runtime activation tests passed");
