import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const script = join(import.meta.dir, "../scripts/install.sh");

function fixture(run: (f: ReturnType<typeof setup>) => void) {
  const f = setup();
  try { run(f); } finally { rmSync(f.root, { recursive: true, force: true }); }
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), "oxc-installer-"));
  const home = join(root, "home");
  const mocks = join(root, "mocks");
  const prefix = join(home, "oxc space'quoted");
  mkdirSync(home);
  mkdirSync(mocks);
  const asset = "opencodex-linux-x64";
  const binary = "#!/bin/sh\ncase \"$1\" in help) echo help;; --version) echo fixture-v1;; *) printf '%s\\n' \"$@\";; esac\n";
  writeFileSync(join(root, "binary"), binary);
  const hash = createHash("sha256").update(binary).digest("hex");
  writeFileSync(join(root, "checksums"), `${hash}  ${asset}\n`);
  writeFileSync(join(root, "metadata"), JSON.stringify([
    { tag_name: "9.9.9", draft: true, prerelease: false },
    { tag_name: "0.0.9", draft: false, prerelease: false,
      assets: [{ tag_name: "99.0.0" }], body: 'ignore "tag_name": "88.0.0"' },
  ]));
  writeFileSync(join(root, "feed"), '<link rel="alternate" type="text/html" href="https://github.com/ar4ft/opencodex/releases/tag/0.0.9"/>\n');
  writeFileSync(join(mocks, "uname"), `#!/bin/sh
case "$1" in -s) echo "\${TEST_OS:-Linux}";; -m) echo "\${TEST_ARCH:-x86_64}";; esac
`, { mode: 0o755 });
  writeFileSync(join(mocks, "sysctl"), "#!/bin/sh\necho 0\n", { mode: 0o755 });
  writeFileSync(join(mocks, "curl"), `#!/bin/sh
set -eu
url=
output=
while [ "$#" -gt 0 ]; do
    case "$1" in
        -o) output=$2; shift 2;;
        https://*) url=$1; shift;;
        *) shift;;
    esac
done
printf '%s\\n' "$url" >> "$FIXTURE_ROOT/requests"
case "$url" in
    https://api.github.com/*)
        [ "\${TEST_API_DOWN:-false}" != true ] || exit 22
        case "$url" in */tags/v*) [ "\${TEST_BARE_ONLY:-false}" != true ] || exit 22;; esac
        cp "$FIXTURE_ROOT/metadata" "$output";;
    */releases.atom) cp "$FIXTURE_ROOT/feed" "$output";;
    */checksums.txt) cp "$FIXTURE_ROOT/checksums" "$output";;
    */opencodex-*) cp "$FIXTURE_ROOT/binary" "$output";;
    */scripts/install.sh) cp "$INSTALL_SCRIPT" "$output";;
    *) exit 22;;
esac
`, { mode: 0o755 });
  const env = { ...process.env, HOME: home, SHELL: "/bin/bash", PATH: `${mocks}:${process.env.PATH}`, FIXTURE_ROOT: root, INSTALL_SCRIPT: script, OXC_VERSION: "latest", OXC_INSTALL_DIR: prefix };
  const install = (args: string[] = [], overrides = {}) => spawnSync("sh", [script, ...args], { env: { ...env, ...overrides }, encoding: "utf8" });
  const command = (alias: string, args: string[], overrides = {}) => spawnSync(join(prefix, "bin", alias), args, { env: { ...env, ...overrides }, encoding: "utf8" });
  return { root, home, prefix, env, install, command };
}

describe.skipIf(process.platform === "win32")("standalone POSIX installer", () => {
  test("installs all aliases, quotes PATH, and updates without duplicate profile entries", () => fixture(f => {
    const first = f.install();
    expect(first.status, first.stderr).toBe(0);
    for (const alias of ["oxc", "ocx", "opencodex"]) {
      expect(f.command(alias, ["--version"]).stdout.trim()).toBe("fixture-v1");
    }
    const sourced = spawnSync("sh", ["-c", '. "$OXC_INSTALL_DIR/env"; command -v oxc'], { env: f.env, encoding: "utf8" });
    expect(sourced.status).toBe(0);
    expect(sourced.stdout.trim()).toBe(join(f.prefix, "bin", "oxc"));
    const profile = readFileSync(join(f.home, ".bashrc"), "utf8");
    const second = f.install();
    expect(second.status, second.stderr).toBe(0);
    expect(readFileSync(join(f.home, ".bashrc"), "utf8")).toBe(profile);
    expect(readFileSync(join(f.prefix, "lib/opencodex.previous"), "utf8")).toBe(readFileSync(join(f.root, "binary"), "utf8"));
    expect(readdirSync(f.prefix).filter(name => name.startsWith(".install"))).toEqual([]);
  }));

  test("oxc update uses GitHub and help performs no network request", () => fixture(f => {
    expect(f.install().status).toBe(0);
    const requests = readFileSync(join(f.root, "requests"), "utf8");
    expect(f.command("oxc", ["update", "--help"]).status).toBe(0);
    expect(readFileSync(join(f.root, "requests"), "utf8")).toBe(requests);
    const updated = f.command("oxc", ["update", "--version", "0.0.9", "--no-modify-path"]);
    expect(updated.status, updated.stderr).toBe(0);
    expect(readFileSync(join(f.root, "requests"), "utf8")).toContain("raw.githubusercontent.com/ar4ft/opencodex");
    expect(f.command("ocx", ["update", "--prefix", "/tmp/unexpected"]).status).toBe(1);
    expect(readdirSync(f.prefix).filter(name => name.startsWith(".update"))).toEqual([]);
  }));

  test("checksum mismatch preserves the old binary, receipt, aliases and profile", () => fixture(f => {
    expect(f.install().status).toBe(0);
    const previous = readFileSync(join(f.prefix, "lib/opencodex"), "utf8");
    const receipt = readFileSync(join(f.prefix, "install-receipt"), "utf8");
    const profile = readFileSync(join(f.home, ".bashrc"), "utf8");
    writeFileSync(join(f.root, "checksums"), `${"0".repeat(64)}  opencodex-linux-x64\n`);
    const failed = f.install();
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain("checksum mismatch");
    expect(readFileSync(join(f.prefix, "lib/opencodex"), "utf8")).toBe(previous);
    expect(readFileSync(join(f.prefix, "install-receipt"), "utf8")).toBe(receipt);
    expect(readFileSync(join(f.home, ".bashrc"), "utf8")).toBe(profile);
    expect(f.command("oxc", ["--version"]).stdout.trim()).toBe("fixture-v1");
  }));

  test("all update-pre aliases select the newest published prerelease ahead of an older preview and skip stable/draft releases", () => fixture(f => {
    expect(f.install().status).toBe(0);
    const requests = readFileSync(join(f.root, "requests"), "utf8");
    expect(f.command("ocx", ["update-pre", "--help"]).status).toBe(0);
    expect(readFileSync(join(f.root, "requests"), "utf8")).toBe(requests);
    writeFileSync(join(f.root, "metadata"), JSON.stringify([
      { tag_name: "0.0.11", draft: false, prerelease: false },
      { tag_name: "0.0.12-preview.1", draft: true, prerelease: true },
      { tag_name: "0.0.10-preview.2", draft: false, prerelease: true },
      { tag_name: "0.0.10-preview.1", draft: false, prerelease: true },
    ]));
    for (const alias of ["oxc", "ocx", "opencodex"]) {
      const updated = f.command(alias, ["update-pre", "--no-modify-path"], { OXC_VERSION: "0.0.9" });
      expect(updated.status, updated.stderr).toBe(0);
      expect(readFileSync(join(f.prefix, "install-receipt"), "utf8")).toContain("version=0.0.10-preview.2\n");
    }
    expect(f.command("oxc", ["update-pre", "--stable"]).status).toBe(1);
    expect(f.command("oxc", ["update-pre"], { TEST_API_DOWN: "true" }).status).toBe(1);
    expect(readFileSync(join(f.prefix, "install-receipt"), "utf8")).toContain("version=0.0.10-preview.2\n");
    writeFileSync(join(f.root, "metadata"), JSON.stringify({ tag_name: "0.0.11", draft: false, prerelease: false }));
    expect(f.command("oxc", ["update-pre"]).status).toBe(1);
    expect(readFileSync(join(f.prefix, "install-receipt"), "utf8")).toContain("version=0.0.10-preview.2\n");
  }));

  test("the CLI update-pre bootstraps standalone installation without npm or inherited version pins", () => fixture(f => {
    const cli = join(import.meta.dir, "../src/cli/index.ts");
    mkdirSync(join(f.home, "opencodex"));
    mkdirSync(join(f.home, "codex"));
    const env = { ...f.env, OXC_VERSION: "0.0.9", OPENCODEX_HOME: join(f.home, "opencodex"), CODEX_HOME: join(f.home, "codex") };
    const invoke = (args: string[]) => spawnSync(process.execPath, [cli, "update-pre", ...args], { env, encoding: "utf8" });
    const help = invoke(["--help"]);
    expect(help.status, help.stderr).toBe(0);
    expect(invoke(["--stable"]).status).toBe(2);
    expect(readdirSync(f.root)).not.toContain("requests");
    writeFileSync(join(f.root, "metadata"), JSON.stringify([
      { tag_name: "0.0.11", draft: false, prerelease: false },
      { tag_name: "0.0.10-preview.2", draft: false, prerelease: true },
    ]));
    const result = invoke(["--no-modify-path"]);
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(f.prefix, "install-receipt"), "utf8")).toContain("version=0.0.10-preview.2\n");
    expect(readFileSync(join(f.root, "requests"), "utf8")).toContain("raw.githubusercontent.com/ar4ft/opencodex");
  }));

  test("a binary that fails its startup check leaves the current installation intact", () => fixture(f => {
    expect(f.install().status).toBe(0);
    const failedBinary = "#!/bin/sh\nexit 9\n";
    const hash = createHash("sha256").update(failedBinary).digest("hex");
    writeFileSync(join(f.root, "binary"), failedBinary);
    writeFileSync(join(f.root, "checksums"), `${hash}  opencodex-linux-x64\n`);
    const failed = f.install();
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain("startup check failed");
    expect(f.command("oxc", ["--version"]).stdout.trim()).toBe("fixture-v1");
  }));

  test("supports bare and v-prefixed tags, rejects prereleases under --stable", () => fixture(f => {
    expect(f.install(["--version", "v0.0.9"], { TEST_BARE_ONLY: "true" }).status).toBe(0);
    expect(readFileSync(join(f.root, "requests"), "utf8")).toContain("/tags/0.0.9");
    writeFileSync(join(f.root, "metadata"), JSON.stringify({ tag_name: "v0.1.0-preview.1", draft: false, prerelease: true }));
    const failed = f.install(["--stable"]);
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain("prerelease");
  }));

  test("feed fallback handles bare tags while stable fails closed", () => fixture(f => {
    expect(f.install([], { TEST_API_DOWN: "true" }).status).toBe(0);
    expect(f.install(["--stable"], { TEST_API_DOWN: "true" }).status).toBe(1);
  }));

  test("a pinned release needs no feed discovery when the API is unavailable", () => fixture(f => {
    const installed = f.install(["--version", "0.0.9"], { TEST_API_DOWN: "true" });
    expect(installed.status, installed.stderr).toBe(0);
    const requests = readFileSync(join(f.root, "requests"), "utf8");
    expect(requests).toContain("/releases/download/0.0.9/");
    expect(requests).not.toContain("releases.atom");
  }));

  test("rejects unsupported platforms and malformed arguments before downloads", () => fixture(f => {
    expect(f.install([], { TEST_OS: "FreeBSD" }).status).toBe(1);
    expect(f.install(["--prefix", "relative"]).status).toBe(1);
    expect(f.install(["--version", "../evil"]).status).toBe(1);
    expect(f.install(["--version"]).status).toBe(1);
    expect(f.install(["--unknown"]).status).toBe(1);
    expect(f.install(["--help"]).status).toBe(0);
    expect(readdirSync(f.root)).not.toContain("requests");
  }));

  test("selects native Linux/macOS x64 and ARM64 assets", () => {
    for (const [os, arch, target] of [
      ["Linux", "x86_64", "linux-x64"], ["Linux", "aarch64", "linux-arm64"],
      ["Darwin", "x86_64", "darwin-x64"], ["Darwin", "arm64", "darwin-arm64"],
    ]) fixture(f => {
      const binary = readFileSync(join(f.root, "binary"));
      const hash = createHash("sha256").update(binary).digest("hex");
      writeFileSync(join(f.root, "checksums"), `${hash}  opencodex-${target}\n`);
      const installed = f.install(["--no-modify-path"], { TEST_OS: os, TEST_ARCH: arch });
      expect(installed.status, installed.stderr).toBe(0);
      expect(readFileSync(join(f.root, "requests"), "utf8")).toContain(`/opencodex-${target}`);
      expect(readdirSync(f.home)).toEqual(["oxc space'quoted"]);
    });
  });

  test("refuses to overwrite an unmanaged installation or a linked command", () => fixture(f => {
    mkdirSync(join(f.prefix, "bin"), { recursive: true });
    writeFileSync(join(f.prefix, "bin/oxc"), "user-owned");
    expect(f.install().status).toBe(1);
    expect(readFileSync(join(f.prefix, "bin/oxc"), "utf8")).toBe("user-owned");
    rmSync(join(f.prefix, "bin/oxc"));
    symlinkSync(join(f.root, "binary"), join(f.prefix, "bin/oxc"));
    const failed = f.install();
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain("symlink");
  }));
});
