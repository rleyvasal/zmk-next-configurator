/**
 * Runtime Config is not live at commit time. Firmware persists generation N,
 * then activates it only when no keys are down. Treat "active" as success.
 */

export function runtimeOverlayIsLive(status, wantedGeneration = 0) {
  const active = Number(status?.activeGeneration || 0);
  const pending = Number(status?.pendingGeneration || 0);
  const idle = !pending || pending === active;
  if (!wantedGeneration) return idle;
  return idle && active >= Number(wantedGeneration);
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForRuntimeStatus(getStatus, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 60000;
  const intervalMs = opts.intervalMs ?? 400;
  const wanted = Number(opts.wantedGeneration || 0);
  const started = Date.now();
  let status = null;
  while (Date.now() - started <= timeoutMs) {
    try {
      status = await getStatus();
    } catch {
      await delay(intervalMs);
      continue;
    }
    if (runtimeOverlayIsLive(status, wanted)) return { ok: true, status };
    opts.onWaiting?.(status);
    await delay(intervalMs);
  }
  return { ok: false, timeout: true, status };
}
