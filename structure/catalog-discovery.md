# Provider Catalog Discovery

GitHub Copilot live discovery uses the authenticated account's chat picker: `model_picker_enabled`
must be true, `capabilities.type` must be `chat`, and disabled/unconfigured policy rows are excluded.
Successful discovery is authoritative even when empty. Configured seeds, dated aliases, and combo
retention cannot add omitted IDs back. Failed discovery may retain a verified cached roster but
cannot infer subscription access from a cold static seed. Explicit `liveModels: false` remains the
manual static-catalog path. `src/codex/catalog/model-hints.ts` reads Copilot's nested context and
prompt limits; `tests/github-copilot-model-discovery.test.ts` covers the account roster behavior.

Provider live-model lists are cached with a configured TTL (`src/codex/model-cache.ts`). Adding,
deleting, or editing a provider's shape clears that per-provider cache; a disabled-only change
deliberately does not, because a disabled provider is already excluded from the catalog gather
instead. Codex's own `models_cache.json` is a different cache, invalidated by catalog refresh.
Account-scoped discovery transports remain bound to the credential snapshot that supplied the
token. Devin discovery uses the allowlisted tenant API base URL from that same snapshot rather
than pairing a durable account key with the provider registry's default host. The same holds for
the provider connection test and for refreshing catalog gathers of every OAuth row: the token and
its origin come from one snapshot, so a Copilot account switch or a refresh that moves the
account's API host cannot pair one account's token with another origin, and a key row never
borrows a stored OAuth account's origin. When the snapshot carries no API host (a legacy credential), the destination comes only from static configuration validated against the vendor allowlist, or the vendor default, and never from the live credential store. If the stored
destination is invalid, registered Devin discovery and routing use the registry's fixed base URL
instead of a stale configured override. For Devin, the irreversible roster fingerprint covers
both credential and validated destination, so switching either observes neither fresh nor stale
data recorded under the previous pair.
Entitlement-specific rosters (Qoder, Devin, Cursor, CodeBuddy) additionally bind their cache entry to an
irreversible credential fingerprint: a credential switch observes neither the fresh nor the stale
roster recorded under the previous credential, and a failed discovery's cooldown neither supplies
the previous credential's stale roster nor suppresses the next credential's first discovery.
Selector decoding uses the same authority boundary through `getRoutingCached`: it resolves a
credential only for a scoped entry, reads OAuth through the passive store observer, and rejects
unavailable or changed authority. Successful API-key selection commits clear the cache and revoke
in-flight publication; unrelated unscoped rows require no credential lookup.

A Devin live row spreads its measured `inputModalities` before
`catalogHintsFromProviderConfig`, so exact `modelCapabilities` declarations, the legacy
`modelInputModalities` record and the vision-sidecar rewrite keep precedence and the live
value survives only when none of them applies. Devin live rows collapse by catalog family (so `swe-1-6-fast` stays its own row), read their ladder from the family effort axis (including `minimal`), and carry the effective enabled default member's effort as `defaultReasoningEffort` when the family marks a default; `swe-1-6` is marked text-only because it drops images without an error.

For `liveModels: false`, a static provider publishes the ordered union of `models` and `retainModels`. When `models` is absent or empty, its configured `defaultModel` seeds that
union before retained ids; a nonempty explicit list does not import a different default.
Kiro keeps this static union as its floor and merges cached account model IDs and input limits; gathering neither refreshes tokens nor calls management, and runtime `/models` discovery remains disabled.
Without any default or configured/retained ids, the static result stays empty. The existing
forward-auth native path remains separate. Static gathering does not refresh OAuth or call
the provider's model endpoint, and normal selection and visibility filters still apply.

The provider workspace uses the existing `/api/models` projection for displayed rows,
model identity and inventory counts. Counts cover distinct non-disabled selectors within
each provider, before search or the render cap; they are not selected-model or live-discovery
counts. The full available list and discovery provenance remain separate inputs.

Deleting a custom definition uses its stable record id and does not also hide the underlying
model. Native or discovered metadata can therefore reappear without changing the inventory
count. Hide uses the represented row's native/routed identity and changes visibility only.
The Models page can restore existing hidden rows; adding a definition does not implicitly
clear a previous hide or provider allowlist. Actions wait for current row and custom-ownership
observations, and mutations reconcile those observations instead of retaining browser-only
removal markers. These presentation operations do not grant routing or account entitlement.
