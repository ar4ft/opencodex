import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { codexIntegrationEnabled, setCodexIntegrationEnabled } from "../../src/codex/desired-state";
import { syncModelsToCodex } from "../../src/codex/sync";
import { maybeAutoRestoreCodexShim } from "../../src/cli/codex-shim-autorestore";

test("native Codex remains excluded with absent, OFF, and old ON settings", async () => {
  for (const clientIntegrations of [undefined, { codex: false }, { codex: true }]) {
    expect(codexIntegrationEnabled({ clientIntegrations })).toBe(false);
    const forbidden = () => { throw Error("Native client machinery ran"); };
    const result = await syncModelsToCodex(undefined, undefined, null, {
      refreshCodexModelCatalog: forbidden, injectCodexConfig: forbidden,
      admitCodexWrite: forbidden, currentExternalCodexModelProvider: forbidden,
      collectCodexHomeDiagnostic: forbidden,
    }, { catalogEvenWhenNotInjected: true });
    expect(result.status).toBe("skipped");
    expect(result.catalogWritten || result.cacheSynced).toBe(false);
  }
  expect(setCodexIntegrationEnabled(true).ok).toBe(false);
  const { tryAcquireNativeMainProfileClaim, tryClaimNativeMainProfileForTurn } = await import("../../src/codex/native-main-admission");
  const { getMainAccountToken } = await import("../../src/codex/main-account");
  expect(tryAcquireNativeMainProfileClaim()).toBeNull();
  expect(tryClaimNativeMainProfileForTurn(undefined, {
    isTrafficBlocked: () => { throw Error("Native profile probed"); },
    claimTurn: () => { throw Error("Native profile claimed"); },
  })).toBe(false);
  expect(getMainAccountToken()).toBeNull();
  maybeAutoRestoreCodexShim("sync", [], {
    env: {}, restore: () => { throw Error("Native shim inspected"); },
    readConfig: () => { throw Error("Native config inspected"); },
    warn: () => { throw Error("Native shim warning"); },
  });
});

function snapshot(dir: string): Record<string, string> {
  return Object.fromEntries(readdirSync(dir, { recursive: true }).sort().flatMap(file => {
    const path = join(dir, String(file)); const stat = statSync(path);
    return stat.isFile() ? [[String(file), `${stat.mtimeMs}:${readFileSync(path).toString("base64")}`]] : [];
  }));
}

test("real sync, legacy restart flags, start, and shutdown leave native homes and launcher untouched", async () => {
  const home = mkdtempSync(join(tmpdir(), "oxc-isolation-"));
  const native = join(home, ".codex"); const app = join(home, "chatgpt"); const own = join(home, ".opencodex");
  for (const dir of [native, app, own, join(home, "bin")]) mkdirSync(dir, { recursive: true });
  for (const name of ["config.toml", "models_cache.json", "opencodex-catalog.json", "auth.json", "opencodex-journal.json"]) {
    writeFileSync(join(native, name), name === "config.toml" ? 'model_provider = "openai"\n' : '{"sentinel":"native"}\n');
  }
  writeFileSync(join(app, "settings.json"), '{"sentinel":"desktop"}\n');
  const marker = join(home, "native-command-ran");
  writeFileSync(join(home, "bin", "codex"), `#!/bin/sh\nprintf invoked > '${marker}'\nexit 0\n`, { mode: 0o755 });
  writeFileSync(join(own, "config.json"), JSON.stringify({
    port: 0, defaultProvider: "mock", providers: { mock: { adapter: "openai-chat", baseUrl: "https://example.com/v1", models: ["test-model"], liveModels: false } },
    clientIntegrations: { codex: true, grok: false, "claude-desktop": false },
    claudeCode: { enabled: false }, syncResumeHistory: true,
  }));
  const env = { ...process.env, HOME: home, CODEX_HOME: native, OPENCODEX_HOME: own,
    PATH: `${join(home, "bin")}:${process.env.PATH}`, CI: "1", OPENCODEX_API_AUTH_TOKEN: "", OCX_SERVICE: "0" };
  const cli = resolve(import.meta.dir, "../../src/cli/index.ts");
  const cliArgv = process.env.OXC_TEST_BINARY ? [process.env.OXC_TEST_BINARY] : [process.execPath, cli];
  const before = [snapshot(native), snapshot(app)];
  let child: ReturnType<typeof Bun.spawn> | undefined;
  try {
    for (const args of [["sync", "--restart-codex", "--restart-desktop-app"], ["sync-cache", "--restart-codex"]]) {
      const result = Bun.spawnSync([...cliArgv, ...args], { env, stdout: "pipe", stderr: "pipe" });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toContain("provider models");
      expect(result.stdout.toString() + result.stderr.toString()).not.toContain("Codex runtime:");
    }
    child = Bun.spawn([...cliArgv, "start"], { env, stdout: "pipe", stderr: "pipe" });
    const reader = child.stdout!.getReader(); let output = "";
    const ready = (async () => {
      while (true) { const chunk = await reader.read(); if (chunk.done) break;
        output += new TextDecoder().decode(chunk.value);
        if (output.includes("Codex integration OFF")) return;
      }
      throw Error(`Proxy exited before startup: ${output}`);
    })();
    let timeout: ReturnType<typeof setTimeout>;
    try { await Promise.race([ready, new Promise((_, reject) => { timeout = setTimeout(() => reject(Error(`Startup timeout: ${output}`)), 15000); })]); }
    finally { clearTimeout(timeout!); }
    const liveSync = Bun.spawnSync([...cliArgv, "sync", "--restart-codex", "--restart-desktop-app"], { env, stdout: "pipe", stderr: "pipe" });
    expect(liveSync.exitCode).toBe(0);
    expect(liveSync.stdout.toString()).toContain("provider models");
    const stopped = Bun.spawn([...cliArgv, "stop"], { env, stdout: "pipe", stderr: "pipe" });
    const [stopCode, stopOut, stopErr] = await Promise.all([stopped.exited, new Response(stopped.stdout).text(), new Response(stopped.stderr).text()]);
    if (stopCode !== 0) throw Error(`Stop fixture failed: ${stopOut} ${stopErr}`);
    expect(await child.exited).toBe(0);
    expect([snapshot(native), snapshot(app)]).toEqual(before);
    expect(readdirSync(home)).not.toContain("native-command-ran");
  } finally { child?.kill(); rmSync(home, { recursive: true, force: true }); }
}, 25000);


test("sync refuses a legacy running proxy before it can invoke native catalog sync", async () => {
  const { dispatchCommand } = await import("../../src/cli/dispatch");
  const calls: string[] = [];
  const legacy = Bun.serve({ port: 0, fetch(req) {
    calls.push(`${req.method} ${new URL(req.url).pathname}`);
    return Response.json({ error: "not found" }, { status: 404 });
  } });
  try {
    const result = await dispatchCommand({ command: "sync" } as import("../../src/cli/root").CliHead, {
      args: ["sync"], findLiveProxy: async () => ({ port: legacy.port, hostname: "127.0.0.1", pid: process.pid }),
      probeHostname: () => "127.0.0.1",
    } as import("../../src/cli/dispatch").CliDispatchDeps);
    expect(result).toBe(1);
    expect(calls).toEqual(["GET /api/fork-client-policy"]);
  } finally { legacy.stop(true); }
});
