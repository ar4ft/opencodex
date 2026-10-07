import type { OcxConfig } from "../types";
import { nativeContextLimits } from "../codex/catalog";
import { mutatePersistedConfig } from "../config";
import { fetchAllModels } from "../server/management/shared";
export interface ClientIntegrationSyncOutcome {
  readonly client: "grok" | "claude-desktop" | "claude-code";
  readonly ok: boolean;
  readonly changed?: boolean;
  readonly reason?: string;
}

/** Refresh provider discovery without accessing native Codex catalogs or caches. */
export async function syncProxyClients(port: number | undefined, config: OcxConfig) {
  const models = await fetchAllModels({ ...config, modelCacheTtlMs: 0 });
  const integrations = await syncEnabledClientIntegrations(port, config);
  return { ok: true, status: "applied", added: models.length, catalogWritten: false,
    cacheSynced: false, message: `Refreshed ${models.length} provider models.`, integrations };
}

export async function syncEnabledClientIntegrations(
  port: number | undefined,
  config: OcxConfig,
): Promise<ClientIntegrationSyncOutcome[]> {
  const { localClientSyncAllowed } = await import("../codex/desired-state");
  if (port === undefined || !localClientSyncAllowed(config)) return [];
  const { claudeDesktopIntegrationEnabled, grokIntegrationEnabled } = await import("../codex/desired-state");
  const out: ClientIntegrationSyncOutcome[] = [];

  if (grokIntegrationEnabled(config)) {
    try {
      const { syncGrokConfig } = await import("../grok/sync");
      const r = await syncGrokConfig(port, config, config.hostname ? { hostname: config.hostname } : {});
      out.push(r.ok
        ? { client: "grok", ok: true, changed: r.changed === true }
        : { client: "grok", ok: false, reason: r.message });
    } catch (error) {
      out.push({ client: "grok", ok: false, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  if (claudeDesktopIntegrationEnabled(config)) {
    try {
      const { writeDesktop3pConfig } = await import("../claude/desktop-3p");
      const { desktopVisibleNativeSlugs } = await import("../codex/catalog");
      const { buildClaudeDesktopState } = await import("../server/management/shared");
      const { reconcileDesktopProfile } = await import("../claude/desktop-profile");
      const state = await buildClaudeDesktopState(config);
      const available = state.models.filter(model => model.available);
      // Save stable date slots before writing Desktop. Later discovery/restarts
      // must decode exactly the IDs installed in its static picker.
      const saved = mutatePersistedConfig(persisted => {
        if (!claudeDesktopIntegrationEnabled(persisted)) return { changed: false, value: null };
        const profile = reconcileDesktopProfile(persisted.claudeCode?.desktopProfile, available);
        persisted.claudeCode = { ...(persisted.claudeCode ?? {}), desktopProfile: profile };
        return { changed: true, value: profile };
      });
      if (saved.status === "unavailable" || !saved.value) {
        throw new Error("Claude Desktop sync could not save its model profile; nothing was applied.");
      }
      config.claudeCode = { ...(config.claudeCode ?? {}), desktopProfile: saved.value };
      const routed = available.filter(model => !model.route.startsWith("native/")).map(model => {
        const slash = model.route.indexOf("/");
        return { provider: model.route.slice(0, slash), id: model.route.slice(slash + 1), contextWindow: model.contextWindow };
      });
      const r = writeDesktop3pConfig(
        port,
        [...desktopVisibleNativeSlugs(config)],
        routed,
        config.apiKeys?.[0]?.key,
        "static",
        config.claudeCode?.desktopProfile,
        nativeContextLimits(config),
      );
      if (r.written && r.fingerprint) {
        const profile = { ...saved.value, appliedFingerprint: r.fingerprint, appliedAt: new Date().toISOString() };
        const marked = mutatePersistedConfig(persisted => {
          if (JSON.stringify(persisted.claudeCode?.desktopProfile) !== JSON.stringify(saved.value)) {
            return { changed: false, value: false };
          }
          persisted.claudeCode = { ...(persisted.claudeCode ?? {}), desktopProfile: profile };
          return { changed: true, value: true };
        });
        if (marked.status !== "unavailable" && marked.value) config.claudeCode.desktopProfile = profile;
      }
      out.push(r.written
        ? { client: "claude-desktop", ok: true, changed: true }
        : { client: "claude-desktop", ok: false, reason: r.reason ?? "Claude Desktop write failed" });
    } catch (error) {
      out.push({ client: "claude-desktop", ok: false, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  if (config.claudeCode?.enabled !== false) {
    try {
      const { refreshGatewayModelCacheFromProxy } = await import("../claude/gateway-cache");
      const cache = await refreshGatewayModelCacheFromProxy(port, { admissionConfig: config });
      const { syncClaudeAgentDefsAtProxyStartup } = await import("../cli/claude-agent-startup-sync");
      const result = config.claudeCode?.injectAgents === false ? [] : await syncClaudeAgentDefsAtProxyStartup(config, port);
      out.push({ client: "claude-code", ok: cache !== null && result !== null,
        ...(cache === null ? { reason: "Claude Code gateway model cache refresh failed" } : {}) });
    } catch (error) {
      out.push({ client: "claude-code", ok: false, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return out;
}
