# Reviewing upstream updates

This fork's **Review upstream stable updates** workflow checks the latest published stable
release of `lidge-jun/opencodex` every Monday at 09:17 UTC, or through a manual dispatch from
`main`. It opens at most one `upstream-update/*` **draft** PR against fork `main`. It never
approves, marks ready, merges, force-pushes, creates tags, signs or publishes an update.
Existing review branches and open update PRs are left alone, including maintainer fixes.

## What the report tells you

`UPSTREAM_REVIEW.md` and the PR body explicitly warn that behavioral compatibility is not
established. They identify potential effects on native Codex/ChatGPT isolation, Copilot
subscription-model discovery, Grok/Claude integrations, proxy/configuration/dashboard behavior,
dependencies, installers and repository automation. They list behavior-related additions,
incoming edits to files already changed by the fork, policy-excluded changes, **all** incoming
paths and the effective candidate diff. Unknown paths still require review. Long reports remain
complete in the committed file; the PR body links that exact commit when abbreviated.

These path and keyword classifications are conservative review aids. They cannot prove whether
a code change alters behavior, nor prove that a new integration bypass is absent. Always inspect
the actual full diff and current head; absence of a warning match is not approval.

## Preserved boundaries

The candidate retains fork `.github/` in full, so incoming upstream workflows and local actions
are excluded. Only our standalone tag-release workflow and this maintenance workflow remain.
The retention list in `scripts/upstream-maintenance.py` also preserves the native-client policy,
provider-only sync, legacy-proxy safety probe, Copilot normalization, standalone installer,
prerelease updater, package launcher, maintenance code and fork regression tests. Incoming
changes to these paths are explicitly listed as excluded, even when Git would merge them cleanly.
Port any needed upstream improvement to a retained file in a separately reviewed change.

Package name, version and command aliases stay on the fork line. Independent dependency/metadata
changes can merge; overlapping dependency or other metadata changes remain conflicts. All other
source changes are normal Git merges and may change behavior. If any conflict remains, the whole
source merge is aborted and the draft PR contains only a conflict report. `UPSTREAM_REVISION`
stays unchanged, and candidate validation is skipped.

`UPSTREAM_REVISION` records the reviewed upstream SHA (initially stable 2.80.0 from PR #9).
Imported or squash-merged history is connected to that baseline with an `ours` merge whose tree
must remain identical. A recorded or ancestral release is skipped. Merge future upstream PRs
with **Create a merge commit**; squashing or rebasing discards their upstream parent history.

## Human approval and validation

Every new update commit gets a pending `upstream/manual-review` status. Review events and new
pushes re-evaluate real GitHub reviews. Success requires an independent **human** with repository
write, maintain or admin permission to submit an **APPROVED** review for the current head SHA.
Bot reviews, checkboxes, comments, the PR author's approval, dismissed approvals and approvals of
older commits do not qualify. Outstanding authorized human change requests keep the status
pending. The automation never marks the PR ready or merges it, even after approval succeeds.

Use a repository ruleset on `main` to require a pull request, at least one approving review and
dismissal of stale reviews, with no automation bypass. Require the relevant validation before
merging upstream updates. **Draft state and commit statuses alone are not branch protection**:
an administrator can manually mark ready and merge unless repository rules prohibit it. The
workflow does not grant itself repository administration permission or change those settings.
Keep GitHub auto-merge disabled. A human must complete the report checklist, inspect test evidence,
approve the current commit, mark ready and merge manually.

Bot-created PRs do not trigger ordinary PR CI through `GITHUB_TOKEN`, so the maintenance run
validates each clean candidate's exact SHA in a separate read-only job. The write jobs check out
trusted fork `main` only and never install dependencies or execute incoming code. The read-only
Linux job installs frozen dependencies, typechecks, scans privacy, compiles the CLI and runs the
fork's isolation, Copilot, Claude, installer and release-classification regressions. It publishes
`upstream/fork-validation` separately from human approval. These are focused Linux checks, not
the full runtime suite, GUI suite or macOS/Windows validation. Review and record additional
coverage before approval, particularly for changed platforms or subsystems.

The workflow leaves an existing PR untouched and does not automatically rerun candidate tests
after manual conflict fixes. Run and record the checks for the new head manually; the old
validation status does not apply to a new commit. No release is published by a maintenance run.
Our existing tag-release workflow remains unchanged and requires its existing tag/release trigger.

## Conflict recovery

Fetch the update branch, merge the incoming SHA from the report, and resolve the conflicts:

```sh
git fetch origin
git checkout upstream-update/vX.Y.Z
git merge --no-ff --no-commit INCOMING_UPSTREAM_SHA
# Preserve the fork boundaries above; remove incoming upstream workflows/actions.
# Resolve source and dependency conflicts deliberately, and retain the fork version/aliases.
git add PATHS_YOU_RESOLVED
printf '%s\n' INCOMING_UPSTREAM_SHA > UPSTREAM_REVISION
# Update UPSTREAM_REVIEW.md to state the resolved changes and validation evidence.
git add UPSTREAM_REVISION UPSTREAM_REVIEW.md
git commit
git push origin HEAD
```

Review the entire diff, especially `.github/`, before pushing. New pushes require a new current-head
human approval. Keep the PR draft until all failures and review items are resolved. Delete the
review branch only after its merge is complete.

## Setup and local checks

Merge this maintenance PR manually to activate the schedule on `main`. Under **Settings → Actions
→ General**, allow GitHub Actions to create pull requests. The workflow uses narrowly scoped
`GITHUB_TOKEN` permissions and pinned action commits; it needs no personal token or release secret.
If PR creation fails, the branch is preserved for manual recovery. Existing branches are never
overwritten. The read-only plan fetches upstream refs but changes no branch or source:

```sh
python3 scripts/upstream-maintenance.py
python3 -m unittest discover -s scripts/tests -p test_upstream_maintenance.py -v
```

`--apply` pushes a branch and opens a draft PR. Run it only when those repository writes are intended.
`--review-pr NUMBER` reports actual current-head human approval; it never submits a review itself.
