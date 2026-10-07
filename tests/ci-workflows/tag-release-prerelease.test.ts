import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const workflow = readFileSync(join(import.meta.dir, "../.github/workflows/tag-release.yml"), "utf8");

function runBlock(step: string): string {
  const lines = workflow.split("\n");
  const start = lines.findIndex(line => line.trim() === `- name: ${step}`);
  if (start < 0) throw new Error(`missing workflow step ${step}`);
  const relative = lines.slice(start).findIndex(line => line.trim() === "run: |");
  if (relative < 0) throw new Error(`missing script for ${step}`);
  const body: string[] = [];
  for (const line of lines.slice(start + relative + 1)) {
    if (line.trim() && !line.startsWith("          ")) break;
    body.push(line.slice(10));
  }
  return body.join("\n");
}

describe.skipIf(process.platform !== "linux")("standalone tag release classification", () => {
  for (const tag of ["0.0.10-preview.1", "v0.0.10-preview.1", "0.0.10"]) {
    test(`${tag} preserves its release channel during creation and publication`, () => {
      const root = mkdtempSync(join(tmpdir(), "oxc-release-workflow-"));
      const log = join(root, "calls.jsonl");
      try {
        mkdirSync(join(root, "bin"));
        mkdirSync(join(root, "dist"));
        writeFileSync(join(root, "bin", "gh"), `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.OXC_RELEASE_TEST_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "release" && args[1] === "view") process.exit(1);
`, { mode: 0o755 });
        for (const platform of ["darwin", "linux", "windows"]) {
          for (const arch of ["x64", "arm64"]) {
            writeFileSync(join(root, "dist", `opencodex-${platform}-${arch}${platform === "windows" ? ".exe" : ""}`), "fixture");
          }
        }
        const env = {
          ...process.env,
          PATH: `${join(root, "bin")}:${process.env.PATH}`,
          OXC_RELEASE_TEST_LOG: log,
          GITHUB_REF_NAME: tag,
          GITHUB_SHA: "a".repeat(40),
          GITHUB_REPOSITORY: "ar4ft/opencodex",
        };
        for (const step of ["Create draft GitHub release", "Upload assets and checksums"]) {
          const result = spawnSync("bash", ["-c", runBlock(step)], { cwd: root, env, encoding: "utf8" });
          expect(result.status, result.stderr).toBe(0);
        }
        const calls = readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line) as string[]);
        const create = calls.find(args => args[1] === "create")!;
        const edit = calls.find(args => args[1] === "edit")!;
        expect(create).toContain("--draft");
        expect(create).toContain("--verify-tag");
        expect(edit).toContain("--draft=false");
        for (const args of [create, edit]) {
          expect(args).toContain(tag);
          expect(args.includes("--prerelease")).toBe(tag.includes("-"));
          expect(args.includes("--latest=false")).toBe(tag.includes("-"));
        }
        expect(readFileSync(join(root, "dist", "checksums.txt"), "utf8").trim().split("\n")).toHaveLength(6);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
});
