# Fork client scope

`src/codex/native-client-policy.ts` excludes native Codex and ChatGPT client integration.
Old ON configurations do not override the fork policy. Native catalog serialization,
injection, restoration, journal writes, bundled catalog probes, and launcher changes refuse
before acquiring native locks or accessing mutable client files. Startup history migration is
disabled. The upstream client architecture is retained as reference; this fork boundary takes
precedence over its native-client behavior. `src/client/connect.ts` also refuses remote native
connect, sync and disconnect before network requests, lifecycle locks or direct catalog writes.

`src/clients/sync.ts` gathers provider models directly and refreshes only enabled Grok/Claude
integrations. `src/cli/dispatch.ts` and `src/server/management/config-routes.ts` use that path.
`sync-cache` aliases provider sync; old restart flags never terminate native client processes.
Native CLI commands, repair flags and hidden Desktop restart/filter helpers are disabled. `src/clients/live-policy.ts` probes the
running proxy read-only before sync, restart, stop or uninstall; legacy proxies without the
isolation policy are refused before their old native shutdown hooks can run.

`src/claude/desktop-request-model.ts` hydrates the Claude Desktop registry before message
translation, including cold gateways and fast variants. Persisted route assignments retain
identity; first-party Desktop mode and sibling ownership are rechecked under the picker transition
before gateway writes. Native routing-healer timers are not started. The legacy `claude-opus-4-8-20260330` slot resolves to Copilot's Fable route when
available. Bare date slots never imply an Opus version. Successful sync persists the refreshed
Desktop profile and refreshes the Claude Code gateway cache independently of agent injection.
`src/claude/desktop-3p.ts` retains upstream's expanded date-slot range, non-date wire aliases
and real Anthropic collision protection. Exact and dateless operator modelMap entries retain
precedence over unresolved slots; registered profile aliases retain their existing precedence.

`src/claude/copilot-model.ts` normalizes explicitly provider-qualified dated Anthropic IDs to
a matching live Copilot version after alias/modelMap translation. It preserves exact IDs,
disabled rows, unknown or ambiguous versions, failed discovery and other providers.
`src/server/claude-messages.ts` applies both resolvers before adapter dispatch.

`tests/codex-integration/fork-native-client-isolation.test.ts` checks real sync, restart flags,
startup and stop against sentinel native files and a fake Codex executable, plus remote-client
entry-point refusal. `tests/claude-integration/claude-fork-copilot-wire.test.ts` verifies cold
Fable routing and sync on the request boundary. The request-model fixtures cover old and new
wire aliases, persisted assignments, unavailable slots and explicit maps.
