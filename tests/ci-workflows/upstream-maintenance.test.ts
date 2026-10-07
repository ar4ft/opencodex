import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { repoPath } from "../helpers/repo-root";

const workflow = readFileSync(repoPath(".github/workflows/upstream-maintenance.yml"), "utf8");

function job(name: string): string {
  const match = workflow.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z-]+:|$(?![\\s\\S]))`, "m"));
  if (!match) throw new Error(`Missing workflow job ${name}`);
  return match[1];
}

test("maintenance exercises real Git merges, retained fork policy and human approval", () => {
  const python = process.platform === "win32" ? "python" : "python3";
  const result = spawnSync(python, ["-m", "unittest", "discover", "-s", "scripts/tests", "-p", "test_upstream_maintenance.py", "-v"], {
    cwd: repoPath(), encoding: "utf8", timeout: 60000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
  if (result.error && "code" in result.error && result.error.code === "ENOENT") {
    throw new Error("Python 3 is required for upstream-maintenance tooling tests");
  }
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.stderr).toContain("\nOK\n");
}, 65000);

test("write jobs run trusted main only; candidate execution has read-only permissions", () => {
  const prepare = job("prepare");
  const review = job("human-review");
  const validate = job("validate");
  expect(prepare).toContain("github.ref == 'refs/heads/main'");
  expect(prepare).toContain("persist-credentials: false");
  expect(prepare).toContain("ref: main");
  expect(prepare).not.toContain("bun install");
  expect(review).toContain("ref: main");
  expect(review).not.toContain("ref: ${{");
  expect(review).not.toContain("contents: write");
  expect(review).toContain("pull-requests: read");
  expect(validate).toContain("contents: read");
  expect(validate).not.toContain(": write");
  expect(validate).not.toContain("GH_TOKEN");
  expect(validate).toContain("OXC_TEST_BINARY");
  expect(validate).toContain("fork-native-client-isolation.test.ts");
  expect(workflow).toContain("permissions: {}");
  const uses = [...workflow.matchAll(/^\s+(?:- )?uses: ([^\s]+)/gm)];
  expect(uses.length).toBeGreaterThan(0);
  for (const use of uses) {
    expect(use[1]).toMatch(/@[a-f0-9]{40}$/);
  }
});
