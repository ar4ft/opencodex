import { autoRestoreCodexShim } from "../codex/shim";
import { codexShimAutoRestoreEnabled, readConfigDiagnostics } from "../config";

export interface CodexShimAutoRestoreCliDeps {
  env: NodeJS.ProcessEnv;
  warn: (message: string) => void;
  restore: typeof autoRestoreCodexShim;
  readConfig: typeof readConfigDiagnostics;
}

const DEFAULT_DEPS: CodexShimAutoRestoreCliDeps = {
  env: process.env,
  warn: message => console.warn(message),
  restore: autoRestoreCodexShim,
  readConfig: readConfigDiagnostics,
};

export function skipsCodexShimAutoRestore(command: string | undefined, args: string[]): boolean {
  if (command === "uninstall" || command === "remove") return true;
  // `lab` is read-only inspection; it must not trigger shim side effects.
  if (command === "lab") return true;
  return command === "codex-shim" && ["install", "uninstall", "remove"].includes(args[1] ?? "");
}

export function maybeAutoRestoreCodexShim(
  command: string | undefined,
  args: string[],
  deps: CodexShimAutoRestoreCliDeps = DEFAULT_DEPS,
): void {
  // Native launchers are outside this fork's client integrations.
  void command; void args; void deps;
}
