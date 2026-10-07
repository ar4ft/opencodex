import type { OcxConfig } from "../types";
import { nativeContextLimits } from "../codex/catalog";
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
  if (port === undefined) return [];
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
      const { desktopVisibleNativeSlugs, filterCatalogVisibleModels } = await import("../codex/catalog");
      const { fetchAllModels } = await import("../server/management-api");
      const routed = filterCatalogVisibleModels(await fetchAllModels(config), config)
        .map(model => ({ provider: model.provider, id: model.id, contextWindow: model.contextWindow }));
      const r = writeDesktop3pConfig(
        port,
        [...desktopVisibleNativeSlugs(config)],
        routed,
        config.apiKeys?.[0]?.key,
        "static",
        config.claudeCode?.desktopProfile,
        nativeContextLimits(config),
      );
      out.push(r.written
        ? { client: "claude-desktop", ok: true, changed: true }
        : { client: "claude-desktop", ok: false, reason: r.reason ?? "Claude Desktop write failed" });
    } catch (error) {
      out.push({ client: "claude-desktop", ok: false, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  if (config.claudeCode?.enabled !== false && config.claudeCode?.injectAgents !== false) {
    const { syncClaudeAgentDefsAtProxyStartup } = await import("../cli/claude-agent-startup-sync");
    const result = await syncClaudeAgentDefsAtProxyStartup(config, port);
    out.push({ client: "claude-code", ok: result !== null });
  }
  return out;
}
