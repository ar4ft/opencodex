import type { OcxConfig } from "../types";
import { desktopVisibleNativeSlugs, filterCatalogVisibleModels, nativeContextLimits } from "../codex/catalog";
import { fetchAllModels } from "../server/management/shared";
import { buildDesktop3pRegistry, resolveDesktop3pAlias } from "./desktop-3p";
import { desktopProfileWireAlias, validDateAlias } from "./desktop-profile";
import { AnthropicRequestError } from "./inbound";

/** Date slots encode a route, not an Anthropic model version. */
export function isDesktopDateSlot(model: string): boolean {
  return validDateAlias(model);
}

/** Hydrate before translation: a cold gateway need not receive /v1/models first. */
export async function refreshDesktopRequestModel(
  config: OcxConfig,
  model: string,
  discover = fetchAllModels,
): Promise<void> {
  model = model.endsWith("--fast") ? model.slice(0, -"--fast".length) : model;
  if (!isDesktopDateSlot(model) && !/^claude-opus-(?:4-8|4)-(?:[a-z][0-9a-z]{2}|p[0-9a-z]{3})$/.test(model)) return;
  const profileRoute = Object.entries(config.claudeCode?.desktopProfile?.assignments ?? {})
    .find(([, assignment]) => assignment.alias === model || desktopProfileWireAlias(assignment.alias) === model)?.[0];
  const profileClaim = profileRoute !== undefined;
  const registered = resolveDesktop3pAlias(model);
  const copilotRoute = registered?.startsWith("github-copilot/") === true
    || profileRoute?.startsWith("github-copilot/") === true;
  // Other providers retain upstream registry identity and missing-slot handling.
  if (!profileClaim && !copilotRoute && config.defaultProvider !== "github-copilot") return;
  const explicit = config.claudeCode?.modelMap;
  if (!profileClaim && (explicit?.[model] || explicit?.[model.replace(/-\d{8}$/, "")])) return;
  // A real Anthropic dated model can use the same spelling. Its native route
  // remains identity unless a Desktop profile or registry claims it.
  if (isDesktopDateSlot(model) && !profileClaim && !resolveDesktop3pAlias(model)
    && config.defaultProvider !== "github-copilot") return;
  const models = filterCatalogVisibleModels(await discover(config), config);
  buildDesktop3pRegistry(
    [...desktopVisibleNativeSlugs(config)],
    models.map(row => ({ provider: row.provider, id: row.id, contextWindow: row.contextWindow })),
    config.claudeCode?.desktopProfile,
    nativeContextLimits(config),
  );
  if (!resolveDesktop3pAlias(model) && (copilotRoute || config.defaultProvider === "github-copilot")) {
    throw new AnthropicRequestError("Claude gateway model mapping is unavailable. Run ocx sync, apply the Claude Desktop profile, and select an available model again.");
  }
}
