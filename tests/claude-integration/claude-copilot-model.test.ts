import { expect, test } from "bun:test";
import { copilotClaudeModelKey, resolveCopilotClaudeModel } from "../../src/claude/copilot-model";
import type { OcxConfig } from "../../src/types";
const config: OcxConfig = {
  port: 10100, defaultProvider: "github-copilot",
  providers: { "github-copilot": { adapter: "openai-chat", baseUrl: "https://api.githubcopilot.com" } },
};
const discover = async () => [{ provider: "github-copilot", id: "claude-opus-4.8" }];
test("dated Claude Opus 4.8 maps to the subscription-confirmed Copilot ID", async () => {
  expect(copilotClaudeModelKey("claude-opus-4-8-20260330")).toBe("claude-opus-4.8");
  expect(await resolveCopilotClaudeModel(config, "claude-opus-4-8-20260330", discover)).toBe("claude-opus-4-8-20260330");
  expect(await resolveCopilotClaudeModel(config, "github-copilot/claude-opus-4-8-20260330", discover)).toBe("github-copilot/claude-opus-4.8");
});
test("dated major-only IDs do not treat the date as a minor version", () => {
  expect(copilotClaudeModelKey("claude-opus-4-20250514")).toBe("claude-opus-4");
});
test("unsupported versions and unknown or unavailable rosters never invent access", async () => {
  for (const roster of [[], [{ provider: "github-copilot", id: "claude-opus-4.7" }]]) {
    expect(await resolveCopilotClaudeModel(config, "github-copilot/claude-opus-4-8-20260330", async () => roster)).toBe("github-copilot/claude-opus-4-8-20260330");
  }
  expect(await resolveCopilotClaudeModel(config, "github-copilot/claude-opus-4-8-20260330", async () => { throw Error("offline"); })).toBe("github-copilot/claude-opus-4-8-20260330");
});
test("exact upstream IDs, disabled rows, and other providers keep their routing", async () => {
  expect(await resolveCopilotClaudeModel(config, "claude-opus-4.8", discover)).toBe("claude-opus-4.8");
  const disabled = { ...config, disabledModels: ["github-copilot/claude-opus-4.8"] };
  expect(await resolveCopilotClaudeModel(disabled, "github-copilot/claude-opus-4-8-20260330", discover)).toBe("github-copilot/claude-opus-4-8-20260330");
  const anthropic = { ...config, providers: { anthropic: { adapter: "anthropic" as const, baseUrl: "https://api.anthropic.com" } }, defaultProvider: "anthropic" };
  expect(await resolveCopilotClaudeModel(anthropic, "claude-opus-4-8-20260330", async () => { throw Error("should not discover"); })).toBe("claude-opus-4-8-20260330");
});
