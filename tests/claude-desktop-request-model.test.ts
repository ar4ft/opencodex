import { afterEach, expect, test } from "bun:test";
import { refreshDesktopRequestModel } from "../src/claude/desktop-request-model";
import { buildDesktop3pRegistry } from "../src/claude/desktop-3p";
import { resolveInboundModel } from "../src/claude/inbound";
import { reconcileDesktopProfile } from "../src/claude/desktop-profile";
import type { OcxConfig } from "../src/types";

const alias = "claude-opus-4-8-20260330";
const route = "github-copilot/claude-fable-5";
const config: OcxConfig = { port: 10100, defaultProvider: "github-copilot", providers: {
  "github-copilot": { adapter: "openai-chat", baseUrl: "https://api.githubcopilot.com" },
} };
const roster = [{ provider: "github-copilot", id: "claude-fable-5" },
  { provider: "github-copilot", id: "claude-opus-4.8" }];
afterEach(() => buildDesktop3pRegistry([], []));

test("the reported date slot recovers Fable, never Opus, after a cold start", async () => {
  buildDesktop3pRegistry([], []);
  await refreshDesktopRequestModel(config, alias, async () => roster);
  expect(resolveInboundModel(alias)).toBe(route);
  buildDesktop3pRegistry([], roster); // a different picker caller rebuilt the registry
  expect(resolveInboundModel(alias)).toBe(route);
});

test("persisted slot assignments win over deterministic allocation", async () => {
  const profile = reconcileDesktopProfile(undefined, [{ route, label: "Fable" }]);
  profile.assignments[route]!.alias = "claude-opus-4-8-20260101";
  const current = { ...config, claudeCode: { desktopProfile: profile } };
  await refreshDesktopRequestModel(current, "claude-opus-4-8-20260101", async () => roster);
  expect(resolveInboundModel("claude-opus-4-8-20260101", current.claudeCode)).toBe(route);
});

test("unavailable and locally hidden Fable slots cannot silently become Opus", async () => {
  const profile = reconcileDesktopProfile(undefined, [{ route, label: "Fable" }]);
  const current = { ...config, claudeCode: { desktopProfile: profile } };
  await expect(refreshDesktopRequestModel(current, alias, async () => roster.slice(1)))
    .rejects.toThrow("model mapping is unavailable");
  await expect(refreshDesktopRequestModel({ ...current, disabledModels: [route] }, alias, async () => roster))
    .rejects.toThrow("model mapping is unavailable");
});

test("explicit mapping and native Anthropic dated IDs retain their route", async () => {
  const discover = async () => { throw Error("must not discover"); };
  await refreshDesktopRequestModel({ ...config, claudeCode: { modelMap: { [alias]: route } } }, alias, discover);
  await refreshDesktopRequestModel({ ...config, defaultProvider: "anthropic" }, alias, discover);
});
