import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

const INSTALLER_URL = "https://raw.githubusercontent.com/ar4ft/opencodex/refs/heads/main/scripts/install.sh";

/** Bootstrap the fork's standalone prerelease updater from npm, a checkout, or a raw binary. */
export function runGithubPrereleaseUpdate(args: readonly string[]): number {
  if (args.some(arg => arg !== "--no-modify-path")) {
    console.error("Usage: ocx update-pre [--no-modify-path]");
    return 2;
  }
  if (process.platform !== "linux" && process.platform !== "darwin") {
    console.error("update-pre supports Linux and macOS. Windows prerelease binaries: https://github.com/ar4ft/opencodex/releases");
    return 1;
  }
  const binaryPrefix = dirname(dirname(process.execPath));
  const managedBinary = basename(process.execPath) === "opencodex"
    && basename(dirname(process.execPath)) === "lib"
    && existsSync(join(binaryPrefix, "install-receipt"));
  const prefix = managedBinary ? binaryPrefix : process.env.OXC_INSTALL_DIR || join(homedir(), ".oxc");
  const scratch = mkdtempSync(join(tmpdir(), "oxc-update-pre-"));
  try {
    const installer = join(scratch, "install.sh");
    const download = spawnSync("curl", [
      "--fail", "--silent", "--show-error", "--location",
      "--proto", "=https", "--proto-redir", "=https", "--tlsv1.2",
      "--connect-timeout", "15", "--max-time", "300", "--retry", "2",
      INSTALLER_URL, "-o", installer,
    ], { stdio: "inherit" });
    if (download.error || download.status !== 0) {
      console.error("Could not download the GitHub prerelease installer. Check curl and network access.");
      return 1;
    }
    const installed = spawnSync("sh", [installer, "--prerelease", "--prefix", prefix, ...args], {
      stdio: "inherit",
      env: { ...process.env, OXC_VERSION: "latest" },
    });
    if (installed.error) {
      console.error("Could not run the GitHub prerelease installer. Check that sh is available.");
      return 1;
    }
    return installed.status ?? 1;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
