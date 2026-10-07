import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'upstream-maintenance.py'
spec = importlib.util.spec_from_file_location('maintenance', SCRIPT)
maintenance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(maintenance)


def git(root, *args):
    return subprocess.check_output(['git', *args], cwd=root, text=True, stderr=subprocess.DEVNULL).strip()


def write(root, path, content):
    file = root / path
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(content)


class MaintenanceTests(unittest.TestCase):
    def fixture(self, conflict=False, imported=False):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        base = Path(temp.name)
        upstream, fork = base / 'upstream', base / 'fork'
        upstream.mkdir()
        git(upstream, 'init', '-b', 'main')
        git(upstream, 'config', 'user.name', 'Test')
        git(upstream, 'config', 'user.email', 'test@example.invalid')
        write(upstream, 'src/cli/source.ts', 'original\n')
        write(upstream, '.github/workflows/upstream.yml', 'name: upstream\n')
        write(upstream, 'package.json', json.dumps({'name': 'upstream', 'version': '2.0.0', 'bin': {'ocx': 'bin/ocx.mjs'}}))
        git(upstream, 'add', '.')
        git(upstream, 'commit', '-m', 'Baseline')
        previous = git(upstream, 'rev-parse', 'HEAD')
        git(base, 'clone', str(upstream), str(fork))
        git(fork, 'config', 'user.name', 'Test')
        git(fork, 'config', 'user.email', 'test@example.invalid')
        git(fork, 'rm', '.github/workflows/upstream.yml')
        write(fork, '.github/workflows/tag-release.yml', 'name: fork release\n')
        write(fork, 'UPSTREAM_REVISION', previous + '\n')
        write(fork, 'src/codex/native-client-policy.ts', 'native writes disabled\n')
        write(fork, 'scripts/install.sh', 'fork installer\n')
        write(fork, 'fork.txt', 'fork customizations\n')
        write(fork, 'package.json', json.dumps({'name': 'fork', 'version': '0.0.10-preview.4', 'bin': {'ocx': 'bin/ocx.mjs', 'oxc': 'bin/ocx.mjs'}}))
        if conflict:
            write(fork, 'src/cli/source.ts', 'fork disables native writes\n')
        if imported:
            git(fork, 'checkout', '--orphan', 'import')
        git(fork, 'add', '.')
        git(fork, 'commit', '-m', 'Fork safeguards')
        if conflict:
            write(upstream, 'src/cli/source.ts', 'upstream native config changed\n')
        else:
            write(upstream, 'src/claude/fix.ts', 'default model = newModel; fetch(url); restart();\n')
        write(upstream, '.github/workflows/new-release.yml', 'name: new upstream release\n')
        write(upstream, 'src/codex/native-client-policy.ts', 'native writes enabled\n')
        write(upstream, 'package.json', json.dumps({'name': 'new upstream', 'version': '2.0.1', 'bin': {'ocx': 'different'}, 'dependencies': {'fix': '1.0.0'}}))
        git(upstream, 'add', '.')
        git(upstream, 'commit', '-m', 'Incoming stable')
        git(upstream, 'tag', 'v2.0.1')
        return fork, upstream, previous

    def clean_fixture(self, imported=False):
        fork, upstream, previous = self.fixture(imported=imported)
        # Avoid the deliberate add/add native policy conflict in clean-merge fixtures.
        git(upstream, 'rm', 'src/codex/native-client-policy.ts')
        git(upstream, 'commit', '-m', 'Keep native policy fork-owned')
        git(upstream, 'tag', '-f', 'v2.0.1')
        return fork, upstream, previous

    def test_clean_merge_retains_fork_workflows_version_aliases_and_upstream_dependencies(self):
        fork, upstream, previous = self.clean_fixture()
        result = maintenance.prepare(fork, 'v2.0.1', str(upstream), True)
        self.assertEqual(result['conflicts'], [])
        self.assertTrue((fork / 'src/claude/fix.ts').exists())
        self.assertEqual((fork / 'fork.txt').read_text(), 'fork customizations\n')
        self.assertEqual((fork / 'src/codex/native-client-policy.ts').read_text(), 'native writes disabled\n')
        self.assertEqual(list((fork / '.github/workflows').iterdir()), [fork / '.github/workflows/tag-release.yml'])
        manifest = json.loads((fork / 'package.json').read_text())
        self.assertEqual(manifest['version'], '0.0.10-preview.4')
        self.assertEqual(manifest['name'], 'fork')
        self.assertIn('oxc', manifest['bin'])
        self.assertEqual(manifest['dependencies'], {'fix': '1.0.0'})
        self.assertEqual((fork / 'UPSTREAM_REVISION').read_text().strip(), result['target'])
        self.assertIn(result['target'], git(fork, 'show', '-s', '--format=%P', 'HEAD').split())
        self.assertEqual(git(fork, 'status', '--porcelain'), '')
        self.assertIn('REVIEW REQUIRED: Enabled Grok / Claude integrations', result['report'])
        self.assertIn('new-release.yml', result['report'])
        self.assertIn('Behavior compatibility is NOT established', result['report'])
        self.assertIn('Other incoming changes', result['report'])

    def test_conflict_aborts_all_source_changes_and_keeps_reference(self):
        fork, upstream, previous = self.fixture(True)
        before = git(fork, 'rev-parse', 'HEAD')
        result = maintenance.prepare(fork, 'v2.0.1', str(upstream), True)
        self.assertIn('src/cli/source.ts', result['conflicts'])
        self.assertIn('src/codex/native-client-policy.ts', result['conflicts'])
        self.assertEqual((fork / 'UPSTREAM_REVISION').read_text().strip(), previous)
        self.assertEqual((fork / 'src/cli/source.ts').read_text(), 'fork disables native writes\n')
        self.assertEqual(git(fork, 'diff', '--name-only', before), 'UPSTREAM_REVIEW.md')
        self.assertEqual(git(fork, 'diff', '--name-only', '--diff-filter=U'), '')
        self.assertIn('source merge aborted', result['report'])

    def test_squashed_import_records_parent_without_replacing_tree(self):
        fork, upstream, previous = self.clean_fixture(imported=True)
        before = git(fork, 'rev-parse', 'HEAD^{tree}')
        result = maintenance.prepare(fork, 'v2.0.1', str(upstream), True)
        self.assertEqual(result['conflicts'], [])
        self.assertEqual(git(fork, 'rev-parse', 'HEAD^1^{tree}'), before)
        self.assertIn(previous, git(fork, 'show', '-s', '--format=%P', 'HEAD^1').split())

    def test_recorded_release_skipped_even_when_history_was_squashed(self):
        fork, upstream, previous = self.clean_fixture(imported=True)
        git(upstream, 'tag', 'v2.0.0', previous)
        before = git(fork, 'rev-parse', 'HEAD')
        self.assertIsNone(maintenance.prepare(fork, 'v2.0.0', str(upstream), True))
        self.assertEqual(git(fork, 'rev-parse', 'HEAD'), before)

    def test_plan_and_already_incorporated_release_do_not_modify_branch(self):
        fork, upstream, previous = self.clean_fixture()
        before = git(fork, 'rev-parse', 'HEAD')
        result = maintenance.prepare(fork, 'v2.0.1', str(upstream))
        self.assertIn('target', result)
        self.assertEqual(git(fork, 'rev-parse', 'HEAD'), before)
        self.assertEqual((fork / 'UPSTREAM_REVISION').read_text().strip(), previous)
        maintenance.prepare(fork, 'v2.0.1', str(upstream), True)
        before = git(fork, 'rev-parse', 'HEAD')
        self.assertIsNone(maintenance.prepare(fork, 'v2.0.1', str(upstream), True))
        self.assertEqual(git(fork, 'rev-parse', 'HEAD'), before)

    def test_existing_branch_dirty_tree_and_invalid_tag_are_rejected(self):
        fork, upstream, previous = self.clean_fixture()
        for tag in ['v2.0.1-preview.1', '--upload-pack=bad', 'v2.0.1\nother']:
            with self.assertRaises(ValueError):
                maintenance.prepare(fork, tag, str(upstream), True)
        write(fork, 'untracked', 'work in progress')
        with self.assertRaises(ValueError):
            maintenance.prepare(fork, 'v2.0.1', str(upstream), True)
        (fork / 'untracked').unlink()
        git(fork, 'branch', 'upstream-update/v2.0.1')
        head = git(fork, 'rev-parse', 'upstream-update/v2.0.1')
        with self.assertRaises(subprocess.CalledProcessError):
            maintenance.prepare(fork, 'v2.0.1', str(upstream), True)
        self.assertEqual(git(fork, 'rev-parse', 'upstream-update/v2.0.1'), head)

    def test_clean_merge_excludes_new_protected_updater_file(self):
        fork, upstream, _ = self.clean_fixture()
        write(upstream, 'src/update/github-prerelease.ts', 'new upstream replacement\n')
        git(upstream, 'add', '.')
        git(upstream, 'commit', '-m', 'Introduce protected updater path')
        git(upstream, 'tag', '-f', 'v2.0.1')
        result = maintenance.prepare(fork, 'v2.0.1', str(upstream), True)
        self.assertFalse((fork / 'src/update/github-prerelease.ts').exists())
        self.assertIn('src/update/github-prerelease.ts', result['report'])

    def test_package_symlink_is_rejected_before_writing(self):
        fork, upstream, _ = self.clean_fixture()
        base = git(fork, 'rev-parse', 'HEAD')
        (fork / 'package.json').unlink()
        outside = fork.parent / 'sentinel'
        outside.write_text('untouched')
        (fork / 'package.json').symlink_to(outside)
        with self.assertRaises(ValueError):
            maintenance.restore_policy(fork, base)
        self.assertEqual(outside.read_text(), 'untouched')

    def test_overlapping_dependencies_remain_conflicts(self):
        fork, upstream, _ = self.clean_fixture()
        for root, version in [(fork, 'fork-choice'), (upstream, 'upstream-choice')]:
            manifest = json.loads((root / 'package.json').read_text())
            manifest['dependencies'] = {'same': version}
            write(root, 'package.json', json.dumps(manifest))
            git(root, 'add', '.')
            git(root, 'commit', '-m', 'Conflicting dependency choice')
        git(upstream, 'tag', '-f', 'v2.0.1')
        before = (fork / 'package.json').read_text()
        result = maintenance.prepare(fork, 'v2.0.1', str(upstream), True)
        self.assertIn('package.json', result['conflicts'])
        self.assertEqual((fork / 'package.json').read_text(), before)


class OrchestrationTests(unittest.TestCase):
    def test_existing_open_review_blocks_all_new_work(self):
        with patch.object(sys, 'argv', ['maintenance', '--apply']), patch.object(maintenance, 'pages', return_value=[{'head': {'ref': 'upstream-update/v2.0.1'}, 'html_url': 'existing-review'}]), patch.object(maintenance, 'api') as fetch, patch.object(maintenance, 'prepare') as prepare, patch.object(maintenance, 'git') as write_git:
            maintenance.main()
            fetch.assert_not_called()
            prepare.assert_not_called()
            write_git.assert_not_called()

    def test_remote_branch_is_never_overwritten(self):
        def fake_git(root, *args):
            return subprocess.CompletedProcess(args, 0, 'existing-ref' if args[0] == 'ls-remote' else '', '')
        with patch.object(sys, 'argv', ['maintenance', '--apply']), patch.object(maintenance, 'pages', return_value=[]), patch.object(maintenance, 'api', return_value={'tag_name': 'v2.0.1', 'draft': False, 'prerelease': False}), patch.object(maintenance, 'git', side_effect=fake_git), patch.object(maintenance, 'prepare') as prepare:
            maintenance.main()
            prepare.assert_not_called()

    def create(self, failure=False, conflicts=False):
        calls = []
        result = {'branch': 'upstream-update/v2.0.1', 'head': 'a' * 40, 'tag': 'v2.0.1', 'conflicts': ['source'] if conflicts else [], 'report': 'Behavior compatibility is NOT established.\n' + 'long report\n' * 6000}
        def fake_run(*args, **kwargs):
            calls.append(args)
            if args[:3] == ('gh', 'pr', 'create'):
                body = Path(args[args.index('--body-file') + 1]).read_text()
                self.assertIn('## Summary', body)
                self.assertIn('## Verification', body)
                self.assertIn('## Checklist', body)
                self.assertIn('COMPLETE report', body)
                self.assertLess(len(body), 65000)
                return subprocess.CompletedProcess(args, 1 if failure else 0, 'https://github.com/ar4ft/opencodex/pull/1', 'PR creation disabled' if failure else '')
            return subprocess.CompletedProcess(args, 0, '', '')
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'outputs'
            with patch.object(sys, 'argv', ['maintenance', '--apply']), patch.dict('os.environ', {'GITHUB_OUTPUT': str(output)}), patch.object(maintenance, 'pages', return_value=[]), patch.object(maintenance, 'api', return_value={'tag_name': 'v2.0.1', 'draft': False, 'prerelease': False}), patch.object(maintenance, 'git', return_value=subprocess.CompletedProcess([], 0, '', '')) as git_call, patch.object(maintenance, 'prepare', return_value=result), patch.object(maintenance, 'run', side_effect=fake_run), patch.object(maintenance, 'status') as status:
                if failure:
                    with self.assertRaisesRegex(RuntimeError, 'branch preserved'):
                        maintenance.main()
                else:
                    maintenance.main()
                status.assert_called_once()
                self.assertEqual(status.call_args.args[:2], (result['head'], 'pending'))
                git_call.assert_any_call(Path(SCRIPT).parent.parent, 'push', 'origin', result['branch'])
                create = [call for call in calls if call[:3] == ('gh', 'pr', 'create')]
                self.assertEqual(len(create), 1)
                self.assertIn('--draft', create[0])
                self.assertNotIn('--force', repr(git_call.call_args_list))
                if failure or conflicts:
                    self.assertFalse(output.exists())
                else:
                    self.assertEqual(output.read_text(), 'check_ref=' + result['head'] + '\n')
                self.assertFalse(any(call[:3] in [('gh', 'pr', 'merge'), ('gh', 'pr', 'review'), ('gh', 'release', 'create')] for call in calls))

    def test_new_update_is_draft_pending_and_exact_commit_validated(self):
        self.create()

    def test_creation_failure_preserves_branch_and_cannot_trigger_validation(self):
        self.create(failure=True)

    def test_conflict_report_never_triggers_candidate_validation(self):
        self.create(conflicts=True)


def review(state='APPROVED', head='current', login='human', kind='User', identifier=1):
    return {'id': identifier, 'state': state, 'commit_id': head, 'user': {'login': login, 'type': kind}}


class ReviewTests(unittest.TestCase):
    def result(self, reviews, permission='write'):
        return maintenance.review_result(reviews, 'current', 'author', lambda _: permission)[0]

    def test_only_authorized_independent_human_current_head_approval_passes(self):
        self.assertEqual(self.result([review()]), 'success')
        for item in [review(head='previous'), review(login='author'), review(kind='Bot'), review(state='COMMENTED')]:
            self.assertEqual(self.result([item]), 'pending')
        self.assertEqual(self.result([review()], 'read'), 'pending')
        self.assertEqual(self.result([]), 'pending')

    def test_dismissal_and_outstanding_human_change_request_block_approval(self):
        self.assertEqual(self.result([review(), review(state='DISMISSED', identifier=2)]), 'pending')
        self.assertEqual(self.result([review(), review(state='CHANGES_REQUESTED', login='other', identifier=2)]), 'pending')
        self.assertEqual(self.result([review(state='CHANGES_REQUESTED'), review(identifier=2)]), 'success')
        self.assertEqual(self.result([review(), review(state='COMMENTED', identifier=2)]), 'success')

    def pr(self):
        return {'state': 'open', 'base': {'ref': 'main'}, 'head': {'ref': 'upstream-update/v2.0.1', 'sha': 'current', 'repo': {'full_name': maintenance.FORK}},
                'user': {'login': 'author'}, 'html_url': 'https://github.com/ar4ft/opencodex/pull/1'}

    def test_review_status_rechecks_live_head_and_never_mutates_pr(self):
        calls = []
        pr = self.pr()
        def fake_api(path):
            if '/collaborators/' in path:
                return {'permission': 'write'}
            return pr
        with patch.object(maintenance, 'api', side_effect=fake_api), patch.object(maintenance, 'pages', return_value=[review()]), patch.object(maintenance, 'status', side_effect=lambda *args: calls.append(args)):
            maintenance.review_pr(1)
        self.assertEqual(calls, [('current', 'success', 'Authorized human approved this exact commit; merge remains manual', pr['html_url'])])
        changed = self.pr()
        changed['head']['sha'] = 'new'
        with patch.object(maintenance, 'api', side_effect=[pr, changed]), patch.object(maintenance, 'pages', return_value=[]), patch.object(maintenance, 'status') as post:
            with self.assertRaises(RuntimeError):
                maintenance.review_pr(1)
            post.assert_not_called()

    def test_foreign_head_or_wrong_base_is_ignored(self):
        for field, value in [('base', {'ref': 'dev'}), ('head', {'ref': 'upstream-update/v2.0.1', 'repo': {'full_name': 'other/fork'}})]:
            pr = self.pr()
            pr[field] = value
            with patch.object(maintenance, 'api', return_value=pr), patch.object(maintenance, 'pages') as fetch, patch.object(maintenance, 'status') as post:
                maintenance.review_pr(1)
                fetch.assert_not_called()
                post.assert_not_called()


if __name__ == '__main__':
    unittest.main()
