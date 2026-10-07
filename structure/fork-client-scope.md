# Fork client scope

`src/codex/native-client-policy.ts` excludes native Codex and ChatGPT client integration.
Old ON configurations do not override the fork policy. Native catalog serialization,
injection, restoration, journal writes, bundled catalog probes, and launcher changes refuse
before acquiring native locks or accessing mutable client files. Startup history migration is
disabled. The upstream client architecture is retained as reference; this fork boundary takes
precedence over its native-client behavior.

`src/clients/sync.ts` gathers provider models directly and refreshes only enabled Grok/Claude
integrations. `src/cli/dispatch.ts` and `src/server/management/config-routes.ts` use that path.
`sync-cache` aliases provider sync; old restart flags never terminate native client processes.
Native CLI commands and repair flags are disabled. Upstream connected-client commands that
apply a native Codex catalog are disabled in this fork.

`src/claude/copilot-model.ts` resolves Anthropic dated IDs to the same version advertised by
Copilot, after normal Claude alias/modelMap translation. It preserves exact IDs, explicit
routing precedence, disabled rows, unknown/ambiguous versions, discovery failures, and other
providers. `src/server/claude-messages.ts` applies the resolver before adapter dispatch.

`tests/fork-native-client-isolation.test.ts` checks real sync, restart flags, startup, and stop
against sentinel native client files and a fake Codex executable. Model-resolution and
request-boundary fixtures verify the Copilot upstream wire ID.
