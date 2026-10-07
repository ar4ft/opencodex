# GitHub Workflows

This fork retains only `.github/workflows/tag-release.yml` for GitHub automation. The upstream
workflow descriptions below document the parent project's automation and do not establish a CI
gate in this fork. The tag workflow compiles six standalone Linux/macOS/Windows binaries across
x64 and arm64, publishes SHA-256 checksums, and marks hyphenated preview tags as prereleases.

`scripts/install.sh` installs the Linux/macOS assets under `~/.oxc`, checks SHA-256 and startup,
and atomically replaces the executable while retaining its predecessor. The `oxc`, `ocx`, and
`opencodex` wrappers route `update` through this fork's HTTPS installer, independently of npm.
The default channel includes prereleases; `--stable` requires API-confirmed stable classification.
Version metadata is embedded through `src/lib/package-version.ts`, so compiled binaries require
no adjacent package manifest. The npm package also exposes the `oxc` alias.

`update-pre` selects the newest API-classified GitHub prerelease, skipping stable and draft
releases. Installed wrappers update their owned prefix; `src/update/github-prerelease.ts` also
bootstraps standalone installation from npm/source or a raw binary. The prerelease channel fails
closed when classification is unavailable. Unsigned binaries still require checksum and startup
verification. Help and invalid CLI arguments perform no download.

## Parent workflow inventory

The PR-target resolver accepts commit-index candidates only when their base repository's
owner and name match the workflow repository. Foreign or incomplete fork-network entries
cannot supply a write-job PR number. If no unique local current-head candidate remains,
the existing repository-scoped open-PR lookup runs; absent or ambiguous matches emit no identity.

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| [ci.yml](https://github.com/lidge-jun/opencodex/blob/main/.github/workflows/ci.yml) | Any `pull_request`; runtime/package `push` to `main`/`preview`; manual dispatch | A pull request verifies Linux and TypeScript: Linux runs four suite shards plus `gates` alongside the scoped docs, structure, packaging, keyring, and npm-global jobs. The `platform-macos` macOS suite, the `widget` macOS widget + Tauri app-bundle build, and the `desktop-shell` Rust toolchain build are native-gated: they run on `main`/`preview` pushes and manual dispatch, and on a pull request only when the `changes` job's native path filter selects the change. `dev` pushes start nothing; dev integration is covered by the pull-request run, while `main` and `preview` must stay push triggers because `release.yml` requires a push-event run for the exact release SHA. Windows runs nine shards only on manual dispatch with `lane=all` (or empty), not on push events. Linux runs at-most-12-file processes with a 120-second process bound; Windows uses measured six-file/480-second processes and all-file scope so its full-suite contract is unchanged. The dedicated Windows batch step sets `OCX_TEST_NO_QUEUE=1` because its sequential processes are one logical runner; each process still creates an isolated home and arms the test guards before the lock boundary. No lane retries: a test failure, a process timeout and a Bun runtime crash each fail their job on the first occurrence. Aggregate `ci` is event-aware — it derives which jobs this event requested and requires `success` from each of them and `skipped` from the rest, and on a `lane=all` dispatch it reads the run's own job list and requires nine concrete successful `windows N/9` results. `npm-global-smoke` remains GitHub-hosted because it mutates the global package prefix. Manual `lane=release-gates` keeps the ordinary native-gated jobs and selected dynamic keyring/packaging matrix legs, but skips the Windows suite and unsharded macOS control. Default `all` (or empty) still requests both diagnostics; `macos-control` requests the control without Windows suite shards. Release eligibility requires successful push-event CI on the exact release SHA; a manual lane does not authorize publishing. Changes that touch only `.github/actions/` or `native/remote-workspace-helper/` run the narrow `setup-action` and `remote-helper` jobs instead of the full matrix, and Linux shard membership follows the per-file durations in `scripts/ci/test-durations.tsv`. |
| [dev-version-bump.yml](https://github.com/lidge-jun/opencodex/blob/main/.github/workflows/dev-version-bump.yml) | Manual dispatch with an intended version and `pre-move` or `repair` mode | Opens the reviewed pull request that moves `dev` past a release target. The default `pre-move` mode runs before promotion and publication; explicit `repair` mode retains the post-publish catch-up path. It is neither called by `release.yml` nor triggered by publication. |
| [release.yml](https://github.com/lidge-jun/opencodex/blob/main/.github/workflows/release.yml) | Manual dispatch only | npm publish/dry-run workflow. The `preflight` job checks channel, version sources, tag, GitHub release, npm, global tag ordering and the `dev` pre-move before any packaging job starts. The publish job repeats those checks, requires a successful push-event Cross-platform CI run for the exact `GITHUB_SHA` (a pull-request run does not qualify), requires `dev` to outrank the target, then checks the target against the freshly fetched global tag set before publish or dry-run. After a real publish, `release-outcomes` reports the public GitHub release, the npm version read-back and the npm dist-tag as separate rows. |
| [deploy-docs.yml](https://github.com/lidge-jun/opencodex/blob/main/.github/workflows/deploy-docs.yml) | `push` to `main` touching `docs-site/**` or the workflow, or manual dispatch | Build and publish the Astro/Starlight docs site to GitHub Pages. This is the deploy path; the pull-request build gate is the `docs-site-build` job in `ci.yml`. |
| [service-lifecycle.yml](https://github.com/lidge-jun/opencodex/blob/main/.github/workflows/service-lifecycle.yml) | `pull_request` to `main`/`dev` and `push` to `main`/`preview`, both filtered on the service path set (`src/service.ts`, `src/cli.ts`, `src/cli/index.ts`, `src/lib/bun-runtime.ts`, `package.json`, `bun.lock`, the workflow), or manual dispatch | Service-lifecycle smoke on three platforms: Linux systemd, macOS launchd, and Windows Scheduled Tasks. Each installs, verifies, stops via `ocx stop`, and uninstalls. The path list is kept in sync with the `release.yml` service-gate regex. |
| [enforce-pr-target.yml](https://github.com/lidge-jun/opencodex/blob/main/.github/workflows/enforce-pr-target.yml) | `pull_request_target` (opened, reopened, edited, labeled, unlabeled, ready_for_review, synchronize) plus default-branch `status` events filtered to successful `CodeRabbit` statuses | The `enforce-target` gate: rejects pull requests whose head ancestry sits on the `main` tip while far behind `dev`, rejects empty or malformed descriptions, requires a GUI screenshot when the title/body mentions `gui` (immediately waivable with the maintainer-controlled `gui-screenshot-waived` label; legacy maintainer comments remain compatibility evidence on later PR events), keeps contributor PRs in draft until a four-box readiness checklist is complete, verifies the CI / latest-dev / Codex+CodeRabbit-findings claims (review threads plus current-head CodeRabbit review-body findings outside the diff range), and adds a `review-ready` status label at the ready moment. CodeRabbit status SHAs must resolve to exactly one open current-head PR before writes. Stacked child PRs targeting another open PR's head skip the wrong-base gate. |
| [enforce-issue-quality.yml](https://github.com/lidge-jun/opencodex/blob/main/.github/workflows/enforce-issue-quality.yml) | `issues` (opened, edited, reopened), `issue_comment` (created, edited), or manual dispatch with an issue number | Issue-template compliance gate. |
| [issue-quality-tests.yml](https://github.com/lidge-jun/opencodex/blob/main/.github/workflows/issue-quality-tests.yml) | `pull_request` and `push` to `main`/`preview` filtered on the issue/PR automation scripts, templates, and their workflows | Tests the issue and PR automation scripts themselves, so the gates cannot rot silently. |
| [issue-triage.yml](https://github.com/lidge-jun/opencodex/blob/main/.github/workflows/issue-triage.yml) | `issues` (opened) | Duplicate detection and triage labeling for new issues. |
| [pr-labeler.yml](https://github.com/lidge-jun/opencodex/blob/main/.github/workflows/pr-labeler.yml) | `pull_request_target` (opened, edited, synchronize, labeled, unlabeled) | Type and path labeling plus title sync; `labeled`/`unlabeled` let a human override enqueue a fresher run in the per-PR concurrency group. |
| [react-doctor.yml](https://github.com/lidge-jun/opencodex/blob/main/.github/workflows/react-doctor.yml) | `pull_request` (opened, synchronize, reopened, ready_for_review) and `push` to `main`; no path filter | React-focused static review. Findings fail the job; write-scoped outputs stay disabled, a contract pinned by `tests/ci-workflows/ci-workflows.test.ts`. |
| [stale-needs-info.yml](https://github.com/lidge-jun/opencodex/blob/main/.github/workflows/stale-needs-info.yml) | `schedule` only (daily 06:15 UTC); deliberately no manual dispatch | Closes issues left in needs-info past the grace period. Manual dispatch is omitted so a branch-selected run cannot execute that branch's body with issue write scope. |

`pull_request_target`, `issues`, and `schedule` workflows always load from the repository default
branch, not from `dev`. Landing a change to one of them on `dev` does not change live behavior until
it is promoted, so those files follow the promotion model rather than ordinary integration.

`scripts/test.ts` owns `SERIAL_FULL_SUITE_FILES`, the shared process-isolation roster. Local
full-suite runs, both macOS paths, and `scripts/ci/run-bun-test-batches.sh` execute those files
alone with fresh process homes, including launchd repair and standalone home/lease cases. Hosted batches assign shard membership by the per-file durations
in `scripts/ci/test-durations.tsv` (sorted round-robin when nothing is recorded), run each shard's
files in sorted order and split only process boundaries; every selected file still runs once.
Ordinary macOS shards select 1/2 and 2/2 from the full file list; macOS control selects 1/1. Both
execute sequential batches of at most 12 files with one worker.
Storage-policy and API-usage families run as singletons, as do manifest-declared files.
This preserves full test membership but does not claim cross-batch shared-process coverage.
Every primary assertion failure, timeout or crash fails the run; diagnostic singleton
attribution never turns a failed primary green. Each control batch has a 300-second process
bound plus 15 seconds for forced reap, inside unchanged 20-minute shard and 75-minute control job caps. Other batch
lanes keep their existing defaults; optional parallelism must be a positive integer.

The Windows selector is an operational stability control, not a security boundary. A pull request
controls the `pull_request` workflow body and can rewrite an event-name check, repository variable,
or selector output. Because this is a public user-owned repository and runner groups are unavailable,
the repository setting **Fork pull request workflows from outside collaborators: Require approval
for all outside collaborators** (`all_external_contributors`) must remain enabled before any self-
hosted runner is registered. Maintainers must inspect workflow changes before approving an external
run. If that setting cannot be verified, unset `OCX_SELF_HOSTED_WINDOWS` and deregister the runner;
the workflow then fails back to `windows-latest` rather than exposing a persistent maintainer host.

Docs-only changes intentionally route through the docs workflow instead of the runtime CI gate. If a
docs change also edits runtime/package/release files, run the relevant local runtime checks before
push and let `ci.yml` provide the Linux/Windows confirmation. Service-related changes
(`src/service.ts`, `src/cli/index.ts`, and the rest of the service path set) additionally trigger the
`service-lifecycle.yml` smoke test on all three platforms.
