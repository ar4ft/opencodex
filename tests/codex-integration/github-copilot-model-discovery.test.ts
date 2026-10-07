import { afterEach, describe, expect, test } from "bun:test";
import { fetchProviderModels, mergeConfiguredModelsIntoLiveCatalog } from "../../src/codex/catalog/provider-fetch";
import { clearModelCache, getProviderDiscoveryStatus } from "../../src/codex/model-cache";
import { providerConfigSeed } from "../../src/providers/derive";
import { getProviderRegistryEntry } from "../../src/providers/registry";
import { GITHUB_COPILOT_API_VERSION } from "../../src/oauth/github-copilot";

const name = "github-copilot";
const seed = providerConfigSeed(getProviderRegistryEntry(name)!);

function row(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    model_picker_enabled: true,
    capabilities: { type: "chat", limits: { max_context_window_tokens: 128_000, max_prompt_tokens: 96_000 } },
    policy: { state: "enabled" },
    ...overrides,
  };
}

afterEach(() => clearModelCache(name));

describe("GitHub Copilot account model sync", () => {
  test("discovers only visible enabled chat models with the Copilot headers", async () => {
    let request: { url: string; headers: Headers } | undefined;
    const provider = {
      ...seed,
      authMode: "key" as const,
      apiKey: "copilot-test-key",
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        request = { url: String(input), headers: new Headers(init?.headers) };
        return Response.json({ data: [
          row("enabled-model"),
          row("policy-disabled", { policy: { state: "disabled" } }),
          row("unconfigured-model", { policy: { state: "unconfigured" } }),
          row("hidden-model", { model_picker_enabled: false }),
          row("embedding-model", { capabilities: { type: "embeddings" } }),
          row("legacy-enabled", { policy: undefined }),
          { id: "unknown-capabilities" },
        ] });
      }) as typeof fetch,
    };
    const models = await fetchProviderModels(name, provider);
    expect(models.map(model => model.id)).toEqual(["enabled-model", "legacy-enabled"]);
    expect(request?.url).toBe("https://api.githubcopilot.com/models");
    expect(request?.headers.get("authorization")).toBe("Bearer copilot-test-key");
    expect(request?.headers.get("copilot-integration-id")).toBe("vscode-chat");
    expect(request?.headers.get("x-github-api-version")).toBe(GITHUB_COPILOT_API_VERSION);
    expect(models[0]?.contextWindow).toBe(128_000);
    expect(models[0]?.maxInputTokens).toBe(96_000);
    expect(getProviderDiscoveryStatus(name)).toEqual({ status: "ok" });
  });

  test("a new sync replaces the roster and an all-disabled response is authoritative", async () => {
    let roster = [row("previously-enabled")];
    let calls = 0;
    const provider = {
      ...seed,
      authMode: "key" as const,
      apiKey: "copilot-test-key",
      fetch: (async () => { calls++; return Response.json({ data: roster }); }) as typeof fetch,
    };
    expect((await fetchProviderModels(name, provider, 0)).map(model => model.id)).toEqual(["previously-enabled"]);
    roster = [row("previously-enabled", { policy: { state: "disabled" } }), row("new-enabled")];
    expect((await fetchProviderModels(name, provider, 0)).map(model => model.id)).toEqual(["new-enabled"]);
    roster = [row("new-enabled", { policy: { state: "disabled" } })];
    expect(await fetchProviderModels(name, provider, 0)).toEqual([]);
    expect(calls).toBe(3);
    expect(getProviderDiscoveryStatus(name)).toEqual({ status: "ok" });
  });

  test("configured aliases and combo targets cannot resurrect unavailable subscription models", () => {
    const live = [{ id: "enabled-dated-20261001", provider: name }];
    const configured = [{ id: "disabled", provider: name }, { id: "enabled-dated", provider: name }];
    const merged = mergeConfiguredModelsIntoLiveCatalog({
      name,
      provider: seed,
      models: live,
      configured,
      retainConfiguredModelIds: new Set(["disabled"]),
    });
    expect(merged.models).toEqual(live);
    expect(merged.droppedConfiguredIds).toEqual(["disabled", "enabled-dated"]);
  });

  test("HTTP failures preserve last-known-good models rather than erase a subscription roster", async () => {
    let healthy = true;
    const provider = {
      ...seed,
      authMode: "key" as const,
      apiKey: "copilot-test-key",
      fetch: (async () => healthy ? Response.json({ data: [row("enabled")] }) : new Response(null, { status: 403 })) as typeof fetch,
    };
    await fetchProviderModels(name, provider, 0);
    healthy = false;
    expect((await fetchProviderModels(name, provider, 0)).map(model => model.id)).toEqual(["enabled"]);
    expect(getProviderDiscoveryStatus(name)).toEqual({ status: "failed", reason: "http", httpStatus: 403 });
  });

  test("a failed cold discovery does not advertise static subscription guesses", async () => {
    const provider = {
      ...seed,
      authMode: "key" as const,
      apiKey: "copilot-test-key",
      fetch: (async () => new Response(null, { status: 403 })) as typeof fetch,
    };
    expect(await fetchProviderModels(name, provider, 0)).toEqual([]);
    expect(getProviderDiscoveryStatus(name)).toEqual({ status: "failed", reason: "http", httpStatus: 403 });
  });

  test("logged-out live discovery does not advertise seeds, while explicit static mode remains available", async () => {
    let calls = 0;
    const provider = {
      ...seed,
      authMode: "oauth" as const,
      fetch: (async () => { calls++; return Response.json({ data: [] }); }) as typeof fetch,
    };
    expect(await fetchProviderModels(name, provider)).toEqual([]);
    expect(calls).toBe(0);
    expect((await fetchProviderModels(name, { ...provider, liveModels: false })).map(model => model.id))
      .toEqual(seed.models!);
    expect(calls).toBe(0);
  });
});
