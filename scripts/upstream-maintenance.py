#!/usr/bin/env python3
"""Prepare upstream stable updates for human review; never merge a PR or release."""
import argparse
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path

FORK = 'ar4ft/opencodex'
UPSTREAM = 'lidge-jun/opencodex'
BASE = 'main'
PREFIX = 'upstream-update/'
REVIEW_STATUS = 'upstream/manual-review'

# These boundaries require a separate, explicitly reviewed fork change.
# Restoring .github also prevents new upstream actions/workflows being activated.
RETAIN = (
    '.github', 'scripts/install.sh', 'scripts/upstream-maintenance.py',
    'scripts/tests/test_upstream_maintenance.py', 'UPSTREAM_MAINTENANCE.md',
    'src/codex/native-client-policy.ts', 'src/clients/live-policy.ts',
    'src/clients/sync.ts', 'src/claude/copilot-model.ts',
    'src/update/github-prerelease.ts', 'bin/ocx.mjs',
    'tests/codex-integration/fork-native-client-isolation.test.ts',
    'tests/cli/fork-live-policy.test.ts',
    'tests/ci-workflows/upstream-maintenance.test.ts',
    'tests/ci-workflows/standalone-installer.test.ts',
    'tests/ci-workflows/tag-release-prerelease.test.ts',
    'tests/claude-integration/claude-copilot-model.test.ts',
    'tests/claude-integration/claude-fork-copilot-wire.test.ts',
    'tests/codex-integration/github-copilot-model-discovery.test.ts',
)
IMPACTS = (
    ('Native Codex / ChatGPT isolation', ('src/codex/', 'src/chatgpt/', 'src/client/', 'src/clients/', 'src/cli/', 'src/server/', 'src/service', 'src/lib/'),
     'May change native-home writes, credentials, catalog/cache injection, launchers, process restarts or startup/shutdown behavior. Native clients must remain untouched.'),
    ('Copilot models and subscription access', ('src/providers/github-copilot', 'src/oauth/github-copilot', 'src/claude/', 'src/codex/catalog', 'src/providers/', 'src/router', 'src/routing/'),
     'May change discovery, enabled-model filtering, aliases, model selection or the provider model sent on the wire.'),
    ('Enabled Grok / Claude integrations', ('src/grok/', 'src/claude/', 'src/clients/', 'src/cli/', 'src/server/claude', 'src/config'),
     'May change client settings, model maps, gateway routing, sync ownership or disabled-integration behavior.'),
    ('Proxy, configuration and dashboard behavior', ('src/', 'gui/', 'desktop/', 'app/', 'native/'),
     'May change request translation, defaults, persistence, migrations, authentication, background work or user controls.'),
    ('Installation, updates, dependencies and releases', ('scripts/', 'bin/', 'package.json', 'bun.lock', 'gui/package.json', 'gui/bun.lock', 'desktop/', 'native/', '.github/'),
     'May change installed commands, update channels, downloads, dependencies, build hooks or repository automation. Fork versions and release destinations require review.'),
)
SIGNALS = re.compile(r'(?i)codex|chatgpt|copilot|claude|grok|model|default|migrat|config|oauth|credential|token|https?://|fetch\(|spawn|kill\(|SIGTERM|restart|autostart|telemetry|workflow|publish')


def run(*args, cwd=None, check=True):
    return subprocess.run(args, cwd=cwd, text=True, capture_output=True, check=check, timeout=180)


def git(root, *args, check=True):
    return run('git', *args, cwd=root, check=check)


def api(path):
    return json.loads(run('gh', 'api', path).stdout)


def pages(path):
    return [item for page in json.loads(run('gh', 'api', '--paginate', '--slurp', path).stdout) for item in page]


def paths(root, previous, target):
    return sorted(filter(None, git(root, 'diff', '--name-only', '-z', previous, target).stdout.split('\0')))


def retained(path):
    return any(path == prefix or path.startswith(prefix + '/') for prefix in RETAIN)


def bullets(items):
    # Render paths as JSON so unusual names cannot inject Markdown or HTML.
    return '\n'.join('- `' + json.dumps(item, ensure_ascii=True).replace('`', '\\u0060') + '`' for item in items) or 'None.'


def report(root, previous, target, base, tag, conflicts, excluded):
    incoming = paths(root, previous, target)
    fork_changes = set(paths(root, previous, base))
    effective = sorted(filter(None, git(root, 'diff', '--cached', '--name-only', '-z', base).stdout.split('\0'))) if not conflicts else []
    introduced = set()
    file = ''
    for line in git(root, 'diff', '--unified=0', previous, target).stdout.splitlines():
        if line.startswith('+++ b/'):
            file = line[6:]
        elif line.startswith('+') and not line.startswith('+++') and SIGNALS.search(line):
            introduced.add(file)
    lines = [f'# Upstream review: {tag}', '',
             '> **Manual human review and approval required. Behavior compatibility is NOT established.**',
             '> No automatic merge, approval, ready-for-review transition, signing, tag or release is performed.', '',
             f'Fork base: `{base}`. Recorded upstream: `{previous}`. Incoming stable: `{target}`.',
             f'[Upstream release](https://github.com/{UPSTREAM}/releases/tag/{tag}) · '
             f'[Upstream delta](https://github.com/{UPSTREAM}/compare/{previous}...{target})', '',
             '## Merge state', '',
             ('**CONFLICTS: source merge aborted. This PR contains a report only; the upstream reference is unchanged.**'
              if conflicts else '**CANDIDATE MERGE: source changes are staged for review; they can alter fork behavior even without conflicts.**'), '',
             bullets(conflicts) if conflicts else 'Protected fork files and package name/version/bin metadata are retained from the fork base.', '',
             '## Behavior impact requiring review', '',
             'These are conservative path-based warnings, not semantic proof. A clean merge or passing tests is not approval. '
             'New behavior can appear outside these categories; review every incoming and effective path below.', '']
    for title, prefixes, consequence in IMPACTS:
        affected = [p for p in incoming if any(p.startswith(prefix) for prefix in prefixes)]
        if affected:
            lines += [f'### REVIEW REQUIRED: {title}', '', consequence, '', bullets(affected), '']
    other = [p for p in incoming if not any(any(p.startswith(prefix) for prefix in prefixes) for _, prefixes, _ in IMPACTS)]
    lines += ['### Other incoming changes — review required', '', bullets(other), '',
              '## Additions with behavior-related signals', '',
              'Added lines mention integration, models, defaults, config, credentials, network, processes or automation. '
              'Only paths are reported; absence of a keyword match does not establish safety.', '', bullets(sorted(introduced)), '',
              '## Incoming changes to files already modified by the fork', '',
              'Review interactions even when Git found no textual conflict.', '', bullets(sorted(fork_changes.intersection(incoming))), '',
              '## Incoming changes excluded by fork policy', '',
              'These incoming edits are NOT integrated automatically. Port any needed fix separately after reviewing the fork contract.', '',
              bullets(excluded), '', '## All incoming paths', '', bullets(incoming), '',
              '## Effective candidate changes against the fork base', '', bullets(effective), '',
              '## Required human approval', '',
              '- [ ] Inspect the actual current PR head and base, the complete diff, and every behavior warning above.',
              '- [ ] Confirm native Codex CLI and ChatGPT app homes, credentials, catalogs, caches, launchers and processes remain untouched.',
              '- [ ] Confirm live Copilot subscription models, Claude aliases/wire routing and enabled Grok/Claude sync still work.',
              '- [ ] Review defaults, migrations, network/auth changes, dependencies and installer/prerelease behavior.',
              '- [ ] Complete explicit security review of authentication, dependency installation, workflows and release tooling.',
              '- [ ] Inspect validation evidence for this exact head; resolve failures and record any untested platforms.',
              '- [ ] Submit a human APPROVED review on the current head. Checkboxes or a bot review do not satisfy upstream/manual-review.',
              '- [ ] Mark ready and merge manually with a merge commit only after review. Never squash/rebase an upstream update.', '']
    return '\n'.join(lines)


def restore_policy(root, base):
    # Remove additions and recover deletions/modifications without running incoming code.
    for path in RETAIN:
        git(root, 'rm', '-r', '-f', '--ignore-unmatch', '--', path)
        if git(root, 'ls-tree', base, '--', path).stdout.strip():
            git(root, 'restore', '--source=' + base, '--staged', '--worktree', '--', path)
    original = json.loads(git(root, 'show', base + ':package.json').stdout)
    package = root / 'package.json'
    if package.is_symlink() or not package.is_file():
        raise ValueError('Incoming package.json must be a regular file')
    merged = json.loads(package.read_text())
    for key in ('name', 'version', 'bin'):
        if key in original:
            merged[key] = original[key]
        else:
            merged.pop(key, None)
    package.write_text(json.dumps(merged, indent=2) + '\n')
    git(root, 'add', '--', 'package.json')


def resolve_package_conflict(root):
    """Keep fork identity; resolve only structurally independent JSON edits."""
    package = root / 'package.json'
    if package.is_symlink():
        return False
    missing = object()

    def merge(base, ours, theirs):
        if ours == theirs or theirs == base:
            return ours
        if ours == base:
            return theirs
        if all(isinstance(value, dict) for value in (base, ours, theirs)):
            result = {}
            for key in sorted(base.keys() | ours.keys() | theirs.keys()):
                value = merge(base.get(key, missing), ours.get(key, missing), theirs.get(key, missing))
                if value is not missing:
                    result[key] = value
            return result
        raise ValueError('Overlapping package metadata/dependency edits require review')

    try:
        stages = git(root, 'ls-files', '--stage', '--', 'package.json').stdout.splitlines()
        if len(stages) != 3 or any(not line.startswith(('100644 ', '100755 ')) for line in stages):
            return False
        base, ours, theirs = [json.loads(git(root, 'show', f':{stage}:package.json').stdout) for stage in (1, 2, 3)]
        result = {}
        for key in sorted(base.keys() | ours.keys() | theirs.keys()):
            value = ours.get(key, missing) if key in ('name', 'version', 'bin') else merge(base.get(key, missing), ours.get(key, missing), theirs.get(key, missing))
            if value is not missing:
                result[key] = value
        package.write_text(json.dumps(result, indent=2) + '\n')
        git(root, 'add', '--', 'package.json')
        return True
    except (ValueError, TypeError, AttributeError):
        return False


def prepare(root, tag, upstream_url, apply=False):
    if not re.fullmatch(r'v?[0-9]+\.[0-9]+\.[0-9]+', tag):
        raise ValueError('Expected a stable MAJOR.MINOR.PATCH tag')
    if git(root, 'status', '--porcelain').stdout.strip():
        raise ValueError('Working tree must be clean')
    previous = (root / 'UPSTREAM_REVISION').read_text().strip()
    if not re.fullmatch(r'[0-9a-f]{40}', previous):
        raise ValueError('UPSTREAM_REVISION must contain a full commit SHA')
    base = git(root, 'rev-parse', 'HEAD').stdout.strip()
    git(root, 'fetch', '--no-tags', upstream_url, 'refs/tags/' + tag)
    target = git(root, 'rev-parse', 'FETCH_HEAD^{commit}').stdout.strip()
    unshallow = ['--unshallow'] if git(root, 'rev-parse', '--is-shallow-repository').stdout.strip() == 'true' else []
    git(root, 'fetch', '--no-tags', *unshallow, upstream_url, previous)
    if target == previous or git(root, 'merge-base', '--is-ancestor', target, base, check=False).returncode == 0:
        print(tag + ' is already reviewed/incorporated; no update PR is needed.')
        return None
    if not apply:
        print(f'Update available: {tag} ({target}); manual review required.')
        return {'tag': tag, 'target': target}
    git(root, 'checkout', '-b', PREFIX + tag)
    # Squashed/imported forks need their recorded upstream parent restored, never their tree replaced.
    if git(root, 'merge-base', '--is-ancestor', previous, 'HEAD', check=False).returncode:
        before = git(root, 'rev-parse', 'HEAD^{tree}').stdout.strip()
        git(root, 'merge', '--allow-unrelated-histories', '--strategy=ours', '--no-ff', previous,
            '-m', 'Record reviewed upstream ancestry without changing fork files')
        if git(root, 'rev-parse', 'HEAD^{tree}').stdout.strip() != before:
            raise RuntimeError('Upstream ancestry recording changed the fork tree')
    # Upstream workflow additions are excluded; conflicts remain visible and require manual resolution.
    merge = git(root, 'merge', '--no-commit', '--no-ff', target, check=False)
    conflicts = git(root, 'diff', '--name-only', '--diff-filter=U').stdout.splitlines()
    if 'package.json' in conflicts and resolve_package_conflict(root):
        conflicts.remove('package.json')
    excluded = [p for p in paths(root, previous, target) if retained(p)]
    if 'package.json' in paths(root, previous, target):
        excluded.append('package.json: fork name/version/bin retained; other fields may change')
    if merge.returncode and (conflicts or git(root, 'rev-parse', '-q', '--verify', 'MERGE_HEAD', check=False).returncode):
        git(root, 'merge', '--abort')
        if not conflicts:
            raise RuntimeError('Upstream merge failed without conflicts: ' + merge.stderr)
    else:
        restore_policy(root, base)
    body = report(root, previous, target, base, tag, conflicts, excluded)
    # Reject upstream symlink redirects before writing maintenance metadata.
    for name in ('UPSTREAM_REVISION', 'UPSTREAM_REVIEW.md'):
        if (root / name).is_symlink():
            raise ValueError('Maintenance metadata must not be symlinks')
    (root / 'UPSTREAM_REVIEW.md').write_text(body)
    git(root, 'add', '--', 'UPSTREAM_REVIEW.md')
    if not conflicts:
        (root / 'UPSTREAM_REVISION').write_text(target + '\n')
        git(root, 'add', '--', 'UPSTREAM_REVISION')
    git(root, 'commit', '-m', f'{"Report conflicts for" if conflicts else "Review"} upstream {tag}')
    return {'branch': PREFIX + tag, 'target': target, 'tag': tag, 'conflicts': conflicts,
            'head': git(root, 'rev-parse', 'HEAD').stdout.strip(), 'report': body}


def review_result(reviews, head, author, permission):
    latest = {}
    for review in sorted(reviews, key=lambda item: item['id']):
        user = review.get('user') or {}
        if user.get('type') != 'User' or user.get('login') == author:
            continue
        if review.get('state') in ('APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'):
            latest[user['login']] = review
    trusted = [review for login, review in latest.items() if permission(login) in ('write', 'maintain', 'admin')]
    if any(review['state'] == 'CHANGES_REQUESTED' for review in trusted):
        return 'pending', 'Human changes requested; resolve before manual approval'
    if any(review['state'] == 'APPROVED' and review.get('commit_id') == head for review in trusted):
        return 'success', 'Authorized human approved this exact commit; merge remains manual'
    return 'pending', 'Authorized human approval of this exact commit is required'


def status(head, state, description, url):
    run('gh', 'api', '--method', 'POST', f'repos/{FORK}/statuses/{head}',
        '-f', 'state=' + state, '-f', 'context=' + REVIEW_STATUS,
        '-f', 'description=' + description, '-f', 'target_url=' + url)


def review_pr(number):
    pr = api(f'repos/{FORK}/pulls/{number}')
    if (pr['state'] != 'open' or pr['base']['ref'] != BASE or
            not pr['head']['ref'].startswith(PREFIX) or
            (pr['head'].get('repo') or {}).get('full_name') != FORK):
        return
    head = pr['head']['sha']
    reviews = pages(f'repos/{FORK}/pulls/{number}/reviews?per_page=100')
    state, description = review_result(reviews, head, pr['user']['login'],
                                      lambda login: api(f'repos/{FORK}/collaborators/{login}/permission')['permission'])
    # Recheck identity and head before posting. A status for an old SHA never approves a new SHA.
    current = api(f'repos/{FORK}/pulls/{number}')
    if current['head']['sha'] != head or current['base']['ref'] != BASE or current['state'] != 'open':
        raise RuntimeError('PR changed during review verification; rerun for the current head')
    status(head, state, description, pr['html_url'])
    print(description)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--apply', action='store_true', help='Push an update branch and open a draft PR')
    group.add_argument('--review-pr', type=int, help='Report actual human approval for an upstream PR')
    args = parser.parse_args()
    if args.review_pr is not None:
        if args.review_pr < 1:
            raise ValueError('PR number must be positive')
        review_pr(args.review_pr)
        return
    root = Path(__file__).resolve().parent.parent
    if args.apply:
        pending = [pr for pr in pages(f'repos/{FORK}/pulls?state=open&base={BASE}&per_page=100')
                   if pr['head']['ref'].startswith(PREFIX)]
        if pending:
            print('Finish the existing upstream PR first: ' + pending[0]['html_url'])
            return
        git(root, 'config', 'user.name', 'github-actions[bot]')
        git(root, 'config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com')
    release = api(f'repos/{UPSTREAM}/releases/latest')
    if release['draft'] or release['prerelease']:
        raise ValueError('Expected a published stable release')
    tag = release['tag_name']
    if not re.fullmatch(r'v?[0-9]+\.[0-9]+\.[0-9]+', tag):
        raise ValueError('Expected a stable MAJOR.MINOR.PATCH tag')
    branch = PREFIX + tag
    if args.apply and git(root, 'ls-remote', '--heads', 'origin', 'refs/heads/' + branch).stdout.strip():
        print('Existing update branch preserved: ' + branch + '. Open its draft PR manually or resolve its previous review.')
        return
    result = prepare(root, tag, f'https://github.com/{UPSTREAM}.git', args.apply)
    if not args.apply or not result or 'branch' not in result:
        return
    git(root, 'push', 'origin', result['branch'])
    status(result['head'], 'pending', 'Authorized human approval of this exact commit is required',
           f'https://github.com/{FORK}/tree/{result["branch"]}')
    with tempfile.TemporaryDirectory(prefix='upstream-pr-') as directory:
        body = Path(directory) / 'body.md'
        report_text = result['report']
        if len(report_text) > 45000:
            report_text = (report_text[:40000].rsplit('\n', 1)[0] + '\n\n**Report abbreviated in the PR body. '
                           'Review the COMPLETE report and full diff before approval:** '
                           f'[UPSTREAM_REVIEW.md](https://github.com/{FORK}/blob/{result["head"]}/UPSTREAM_REVIEW.md)\n')
        body.write_text('## Summary\n\n' + report_text + '\n## Verification\n\n'
                        'Candidate validation is recorded by the maintenance workflow for the exact head. '
                        'Conflict reports have no candidate source validation. Tests do not establish behavioral compatibility.\n\n'
                        '## Checklist\n\n- [ ] Complete all human review items above before manually marking ready and merging.\n')
        pr = run('gh', 'pr', 'create', '--repo', FORK, '--base', BASE, '--head', result['branch'],
                 '--draft', '--title', f'Review upstream {tag} for fork behavior changes', '--body-file', str(body), check=False)
    if pr.returncode:
        raise RuntimeError('Draft PR creation failed; branch preserved. Enable GitHub Actions PR creation in repository settings '
                           'or open the draft manually from ' + result['branch'] + '. ' + pr.stderr)
    print(pr.stdout.strip())
    if not result['conflicts'] and os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            output.write('check_ref=' + result['head'] + '\n')


if __name__ == '__main__':
    main()
