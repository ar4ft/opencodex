---
title: Fork lifecycle
description: Grok and Claude lifecycle in the ar4ft fork.
---

The ar4ft fork supports Grok and Claude client integration. Native Codex CLI, Codex Desktop,
and the ChatGPT app stay independent, including with older configs that enable integration.
No startup, sync, shutdown, or update operation changes their configuration, catalogs, caches,
history, or launchers, or restarts their processes. Existing artifacts from earlier releases
are left untouched; this release does not attempt to restore native files automatically.

```sh
ocx update-pre
ocx start
ocx sync
```

`ocx sync` forces provider discovery in the running proxy and refreshes enabled Grok/Claude
integrations. With the proxy stopped it discovers models and reports that client refresh needs
`ocx start`. `ocx sync-cache` is an alias. Older `--restart-codex` and
`--restart-desktop-app` arguments are accepted for compatibility and have no process effects.

GitHub Copilot's live picker is authoritative: only enabled chat models appear. Discovery
failure can retain a verified roster, but cannot infer access from configured seeds.

`ocx sync` refreshes Claude Desktop's static model list and Claude Code's gateway cache.
Launch Claude Code with `ocx claude` and select models using `/model`. After refreshing Desktop,
quit and reopen Claude to reload its picker. Use `ocx claude desktop apply --static` to enable
Desktop integration explicitly.

Desktop date slots encode routes, not Anthropic versions. For example,
`claude-opus-4-8-20260330` identifies `github-copilot/claude-fable-5`, not Opus 4.8.
The gateway recovers aliases before the first request and sync persists stable assignments.
Unavailable slots are rejected locally rather than sent unchanged to Copilot. Explicit
provider-qualified Anthropic IDs can normalize to the same Copilot-advertised version.

Claude's public model catalog describes native model capabilities, not Copilot entitlements.
New models appear when Copilot advertises them as enabled chat models. A provider selection
can hide newly discovered models; `ocx models selected github-copilot --clear` removes that
selection, then `ocx sync` updates the pickers. Explicitly disabled models remain hidden.

The dashboard is http://localhost:10100/ by default; `ocx status` prints its live address.
On macOS, `open http://localhost:10100/` opens it directly if `ocx gui` does not launch a browser.

Updates replace the binary, not the running process. Preview.2 and earlier shutdown hooks
may restore native Codex files, so the new CLI refuses their stop/restart/uninstall paths.
Verify the old proxy PID using `ocx status`, terminate only that process with SIGKILL, then
run `ocx start` and `ocx sync`. Active proxy requests are interrupted. With later releases,
use `ocx stop` followed by `ocx start` to run the updated binary.

`ocx init` saves proxy configuration without prompting for Codex injection or launcher changes.
Native integration commands (`restore`, `recover-history`, `codex-shim`) and native repair flags
are disabled. Grok and Claude integration switches remain independent.

`ocx stop` stops the proxy and cleans up its managed Grok configuration. Requests through the
proxy require a running listener. Services and the standalone installer keep their existing
installation and update behavior. `ocx update-pre` selects the latest published prerelease;
`ocx update` retains its established stable/default channel behavior.
