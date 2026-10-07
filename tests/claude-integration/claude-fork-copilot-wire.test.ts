import { afterEach, beforeEach, expect, test } from "bun:test";
import { managementFetch as fetch } from "../helpers/management-auth";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, saveConfig } from "../../src/config";
import { startServer } from "../../src/server";
import { installIsolatedCodexHome, type IsolatedCodexHome } from "../helpers/isolated-codex-home";
let testDir = "";
let previousHome: string | undefined;
let previousDesktopConfigDir: string | undefined;
let isolatedCodexHome: IsolatedCodexHome | null = null;
const originalFetch = globalThis.fetch;
beforeEach(() => {
  previousHome = process.env.OPENCODEX_HOME;
  isolatedCodexHome = installIsolatedCodexHome("ocx-claude-endpoint-");
  testDir = mkdtempSync(join(tmpdir(), "ocx-claude-endpoint-"));
  process.env.OPENCODEX_HOME = testDir;
  previousDesktopConfigDir = process.env.OPENCODEX_CLAUDE_DESKTOP_CONFIG_DIR;
  process.env.OPENCODEX_CLAUDE_DESKTOP_CONFIG_DIR = join(testDir, "claude-desktop");
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.OPENCODEX_HOME;
  else process.env.OPENCODEX_HOME = previousHome;
  if (previousDesktopConfigDir === undefined) delete process.env.OPENCODEX_CLAUDE_DESKTOP_CONFIG_DIR;
  else process.env.OPENCODEX_CLAUDE_DESKTOP_CONFIG_DIR = previousDesktopConfigDir;
  isolatedCodexHome?.restore();
  isolatedCodexHome = null;
  globalThis.fetch = originalFetch;
  if (testDir) rmSync(testDir, { recursive: true, force: true });
});

function mockChatUpstreamCapturing() {
  const captured: Array<Record<string, unknown>> = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (!url.pathname.endsWith("/chat/completions")) {
        return Response.json({ error: { message: `unexpected path ${url.pathname}` } }, { status: 404 });
      }
      try { captured.push(await req.json() as Record<string, unknown>); } catch { /* keep streaming */ }
      const frames = [
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant", content: "Hello" } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: " from mock" } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 3 } })}\n\n`,
        "data: [DONE]\n\n",
      ];
      return new Response(frames.join(""), { headers: { "Content-Type": "text/event-stream" } });
    },
  });
  return { server, captured };
}
test("Claude dated Opus ID reaches Copilot using its advertised dotted version", async () => {
  const upstream = mockChatUpstreamCapturing();
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === "api.githubcopilot.com") {
      if (url.pathname === "/models") return Promise.resolve(Response.json({ data: [{
        id: "claude-opus-4.8", model_picker_enabled: true, capabilities: { type: "chat" }, policy: { state: "enabled" },
      }] }));
      return originalFetch(new URL(url.pathname, upstream.server.url), init);
    }
    return originalFetch(input, init);
  }) as typeof globalThis.fetch;
  saveConfig({
    port: 0, defaultProvider: "github-copilot",
    providers: { "github-copilot": { adapter: "openai-chat", baseUrl: "https://api.githubcopilot.com", authMode: "key", apiKey: "k",
      models: ["claude-opus-4.8"] } },
  });
  const server = startServer(0);
  try {
    const response = await fetch(new URL("/v1/messages", server.url), {
      method: "POST", headers: { "content-type": "application/json", "x-api-key": "placeholder" },
      body: JSON.stringify({ model: "github-copilot/claude-opus-4-8-20260330", max_tokens: 128, stream: false, messages: [{ role: "user", content: "hi" }] }),
    });
    expect(response.status).toBe(200);
    await response.text();
    expect(upstream.captured.at(-1)?.model).toBe("claude-opus-4.8");
  } finally { server.stop(true); upstream.server.stop(true); }
}, 20000);

test("Claude Fable date slot survives cold routing and sync refreshes both Claude pickers", async () => {
  const { buildDesktop3pRegistry, inspectDesktop3pConfigLibrary } = await import("../../src/claude/desktop-3p");
  const { clearModelCache } = await import("../../src/codex/model-cache");
  clearModelCache();
  buildDesktop3pRegistry([], []);
  const previousClaudeDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = join(testDir, "claude-code");
  const upstream = mockChatUpstreamCapturing();
  let roster = ["claude-fable-5", "claude-opus-4.8"];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === "api.githubcopilot.com") {
      if (url.pathname === "/models") return Promise.resolve(Response.json({ data: roster.map(id => ({
        id, model_picker_enabled: true, capabilities: { type: "chat" }, policy: { state: "enabled" },
      })) }));
      return originalFetch(new URL(url.pathname, upstream.server.url), init);
    }
    return originalFetch(input, init);
  }) as typeof globalThis.fetch;
  saveConfig({ port: 0, defaultProvider: "github-copilot",
    clientIntegrations: { codex: true, grok: false, "claude-desktop": true },
    claudeCode: { injectAgents: false, desktopNativeModels: false },
    providers: { "github-copilot": { adapter: "openai-chat", baseUrl: "https://api.githubcopilot.com", authMode: "key", apiKey: "k" } },
  });
  const server = startServer(0);
  const message = () => fetch(new URL("/v1/messages", server.url), {
    method: "POST", headers: { "content-type": "application/json", "x-api-key": "placeholder" },
    body: JSON.stringify({ model: "claude-opus-4-8-20260330", max_tokens: 128, stream: false, messages: [{ role: "user", content: "hi" }] }),
  });
  const sync = () => fetch(new URL("/api/sync", server.url), { method: "POST" });
  try {
    // No discovery call or Desktop apply is required before the first message.
    const first = await message();
    expect(first.status).toBe(200);
    await first.text();
    expect(upstream.captured.at(-1)?.model).toBe("claude-fable-5");

    roster.push("claude-fable-5.1", "claude-opus-5.5", "claude-sonnet-5.5");
    const refreshed = await sync();
    expect(refreshed.status).toBe(200);
    const result = await refreshed.json() as { integrations: Array<{ client: string; ok: boolean }> };
    expect(result.integrations).toContainEqual({ client: "claude-code", ok: true });
    expect(result.integrations.find(row => row.client === "claude-desktop")?.ok).toBe(true);
    const profile = loadConfig().claudeCode?.desktopProfile;
    expect(profile?.assignments["github-copilot/claude-fable-5"]?.alias).toBe("claude-opus-4-8-20260330");
    const installed = inspectDesktop3pConfigLibrary();
    const desktop = JSON.parse(readFileSync(installed.selectedProfilePath!, "utf8"));
    for (const label of ["Claude Fable 5.1", "Claude Opus 5.5", "Claude Sonnet 5.5"]) {
      expect(desktop.inferenceModels.some((row: { labelOverride: string }) => row.labelOverride.includes(label))).toBe(true);
    }
    expect(profile?.appliedFingerprint).toBeTruthy();
    const cliCache = JSON.parse(readFileSync(join(process.env.CLAUDE_CONFIG_DIR!, "cache/gateway-models.json"), "utf8"));
    for (const id of ["claude-fable-5.1", "claude-opus-5.5", "claude-sonnet-5.5"]) {
      expect(cliCache.models.some((row: { display_name: string }) => row.display_name.includes(id))).toBe(true);
    }

    await fetch(new URL("/v1/models?flavor=anthropic&ids=cli", server.url));
    const afterDiscovery = await message();
    expect(afterDiscovery.status).toBe(200);
    await afterDiscovery.text();
    expect(upstream.captured.at(-1)?.model).toBe("claude-fable-5");

    roster = roster.filter(id => id !== "claude-fable-5");
    expect((await sync()).status).toBe(200);
    const capturedCount = upstream.captured.length;
    const unavailable = await message();
    expect(unavailable.status).toBe(400);
    expect(await unavailable.text()).toContain("model mapping is unavailable");
    expect(upstream.captured.length).toBe(capturedCount);
  } finally {
    if (previousClaudeDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previousClaudeDir;
    server.stop(true); upstream.server.stop(true);
    clearModelCache(); buildDesktop3pRegistry([], []);
  }
}, 20000);
