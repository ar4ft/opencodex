import type { LiveProxy } from "../server/proxy-liveness";
import { probeHostname } from "../server/proxy-liveness";
import { runtimeRequest } from "../cli/runtime-api";

/** Older proxy shutdown handlers can restore native Codex even when integration is OFF. */
export async function assertNativeSafeProxyLifecycle(live: LiveProxy): Promise<void> {
  try {
    const policy = await runtimeRequest<{ version?: number; nativeClientIntegration?: boolean }>(
      "/api/fork-client-policy", {}, { baseUrl: `http://${probeHostname(live.hostname)}:${live.port}` },
    );
    if (policy.version === 1 && policy.nativeClientIntegration === false) return;
  } catch { /* Refuse before triggering any older shutdown handlers. */ }
  throw new Error(`Running proxy predates native-client isolation. Its shutdown hooks may modify Codex. Terminate only the old opencodex proxy${live.pid ? ` (PID ${live.pid})` : ""} before starting this release.`);
}
