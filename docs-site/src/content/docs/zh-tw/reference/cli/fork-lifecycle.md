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

Claude dated IDs map only to the same version advertised by Copilot. For example,
`claude-opus-4-8-20260330` routes as `github-copilot/claude-opus-4.8` when that model is available.
If a requested version is absent, choose an enabled model from the proxy's live list. Explicit
Claude model mappings keep their precedence.

`ocx init` saves proxy configuration without prompting for Codex injection or launcher changes.
Native integration commands (`restore`, `recover-history`, `codex-shim`) and native repair flags
are disabled. Grok and Claude integration switches remain independent.

`ocx stop` stops the proxy and cleans up its managed Grok configuration. Requests through the
proxy require a running listener. Services and the standalone installer keep their existing
installation and update behavior. `ocx update-pre` selects the latest published prerelease;
`ocx update` retains its established stable/default channel behavior.
