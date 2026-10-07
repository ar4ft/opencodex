import type { OcxConfig } from "../types";
import { routeModel } from "../router";
import { routedSlug } from "../providers/slug-codec";
import { filterCatalogVisibleModels } from "../codex/catalog";
import { fetchAllModels } from "../server/management/shared";

/** Compare Anthropic's dated, hyphenated IDs with Copilot's dotted version IDs. */
export function copilotClaudeModelKey(id: string): string | null {
  const match = /^claude-(opus|sonnet|haiku)-(\d{1,3})(?:[.-](\d{1,3}))?(?:-(\d{8}))?$/.exec(id);
  if (!match) return null;
  return `claude-${match[1]}-${match[2]}${match[3] ? `.${match[3]}` : ""}`;
}

/** Never invent access or substitute another model version: discovery must confirm the ID. */
export async function resolveCopilotClaudeModel(
  config: OcxConfig,
  model: string,
  discover = fetchAllModels,
): Promise<string> {
  let route: ReturnType<typeof routeModel>;
  try { route = routeModel(config, model); } catch { return model; }
  if (route.providerName !== "github-copilot") return model;
  const key = copilotClaudeModelKey(route.modelId);
  if (!key) return model;
  let discovered: Awaited<ReturnType<typeof discover>>;
  try { discovered = await discover(config); } catch { return model; }
  const models = filterCatalogVisibleModels(discovered, config)
    .filter(row => row.provider === route.providerName);
  if (models.some(row => row.id === route.modelId)) return model;
  const matches = models.filter(row => copilotClaudeModelKey(row.id) === key);
  return matches.length === 1 ? routedSlug(route.providerName, matches[0]!.id) : model;
}
