import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

MODULE = Path(__file__).with_name('install.py')


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name).resolve()
        spec = importlib.util.spec_from_file_location('efficiency_install', MODULE)
        self.mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.mod)

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, relative, content):
        p = self.home / relative
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)
        return p

    def test_json_preserves_other_settings_and_rejects_conflict(self):
        raw = '{"token":"private-value","mcpServers":{"old":{"command":"other"}}}'
        result = self.mod.merge_json(raw, {'command': '/tools/serena'})
        doc = json.loads(result)
        self.assertEqual(doc['token'], 'private-value')
        self.assertEqual(doc['mcpServers']['old']['command'], 'other')
        self.assertEqual(result, self.mod.merge_json(result, {'command': '/tools/serena'}))
        with self.assertRaises(ValueError):
            self.mod.merge_json(result, {'command': '/changed/unowned'})
        with self.assertRaises(ValueError):
            self.mod.merge_json('{"mcpServers": []}', {})

    def test_toml_preserves_comments_and_config_and_rejects_conflict(self):
        raw = '# retain\nmodel = "existing"\n[mcp_servers.other]\ncommand = "old"\n'
        result = self.mod.merge_toml(raw, '/tools/serena')
        self.assertTrue(result.startswith(raw))
        self.assertEqual(result, self.mod.merge_toml(result, '/tools/serena'))
        with self.assertRaises(ValueError):
            self.mod.merge_toml('[mcp_servers.serena]\ncommand="custom"\n', '/tools/serena')
        with self.assertRaises(Exception):
            self.mod.merge_toml('[broken', '/tools/serena')

    def test_managed_rule_block_preserves_user_text(self):
        raw = '# Custom rules\nKeep this.\n'
        merged = self.mod.managed_rules(raw, 'Use compact output.')
        self.assertTrue(merged.startswith(raw))
        self.assertEqual(merged, self.mod.managed_rules(merged, 'Use compact output.'))
        changed = self.mod.managed_rules(merged, 'Updated rule.')
        self.assertEqual(changed.count(self.mod.BEGIN), 1)
        self.assertIn('Keep this.', changed)
        with self.assertRaises(ValueError):
            self.mod.managed_rules(raw + self.mod.BEGIN, 'anything')

    def test_apply_is_private_idempotent_and_rollback_restores_bytes_mode(self):
        p = self.write('rules.md', 'original\n'); p.chmod(0o640)
        fresh = self.home/'new.txt'
        plan = self.mod.Plan(self.home)
        plan.add(p, b'updated\n', mode=0o600)
        plan.add(fresh, b'created\n', mode=0o700)
        manifest = plan.apply()
        self.assertEqual(p.read_bytes(), b'updated\n')
        self.assertEqual(manifest.stat().st_mode & 0o777, 0o600)
        again = self.mod.Plan(self.home); again.add(p,b'updated\n',mode=0o600)
        self.assertIsNone(again.apply())
        self.mod.rollback(self.home, manifest)
        self.assertEqual(p.read_bytes(), b'original\n')
        self.assertEqual(p.stat().st_mode & 0o777, 0o640)
        self.assertFalse(fresh.exists())

    def test_mode_only_install_rolls_back(self):
        a=self.write('a','same');a.chmod(0o640)
        p=self.mod.Plan(self.home);p.add(a,b'same',mode=0o600);m=p.apply()
        self.mod.rollback(self.home,m)
        self.assertEqual(a.stat().st_mode & 0o777,0o640)

    def test_concurrent_chmod_before_apply_is_preserved(self):
        a=self.write('a','same');a.chmod(0o640)
        p=self.mod.Plan(self.home);p.add(a,b'new',mode=0o600);a.chmod(0o400)
        with self.assertRaises(ValueError):p.apply()
        self.assertEqual(a.read_text(),'same')
        self.assertEqual(a.stat().st_mode & 0o777,0o400)

    def test_rollback_drift_aborts_before_any_restore(self):
        a=self.write('a','a'); b=self.write('b','b')
        p=self.mod.Plan(self.home); p.add(a,b'A');p.add(b,b'B');m=p.apply()
        b.write_text('user change')
        with self.assertRaises(ValueError): self.mod.rollback(self.home,m)
        self.assertEqual(a.read_text(),'A')
        self.assertEqual(b.read_text(),'user change')

    def test_concurrent_edit_during_rollback_is_preserved(self):
        a=self.write('a','a');b=self.write('b','b')
        p=self.mod.Plan(self.home);p.add(a,b'A');p.add(b,b'B');m=p.apply()
        original_atomic=self.mod.atomic
        def interleaved(path,data,mode=0o600):
            if path==b:a.write_text('concurrent user edit')
            return original_atomic(path,data,mode)
        self.mod.atomic=interleaved
        with self.assertRaises(ValueError):self.mod.rollback(self.home,m)
        self.assertEqual(a.read_text(),'concurrent user edit')
        self.assertEqual(b.read_text(),'b')

    def test_concurrent_edit_between_plan_and_apply_is_preserved(self):
        a=self.write('a','original');p=self.mod.Plan(self.home);p.add(a,b'new')
        a.write_text('concurrent')
        with self.assertRaises(ValueError):p.apply()
        self.assertEqual(a.read_text(),'concurrent')

    def test_owned_binary_conflict_and_external_symlink_rejected(self):
        a=self.write('a','custom');p=self.mod.Plan(self.home)
        with self.assertRaises(ValueError):p.add(a,b'new',owned=True)
        external=Path(self.tmp.name).parent/'outside-target'
        link=self.home/'link';link.symlink_to(external)
        with self.assertRaises(ValueError):p.add(link,b'new')

    def test_config_preflight_happens_before_writes(self):
        self.write('.gemini/settings.json','{"broken":')
        with self.assertRaises(Exception):
            self.mod.build_plan(self.home, Path('/tools/python'),Path('/tools/serena'),Path('/tools/rtk'))
        self.assertFalse((self.home/'.local/bin/agent-run').exists())


if __name__ == '__main__':
    unittest.main()
