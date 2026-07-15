#!/usr/bin/env python3
"""Integration tests for installing the shared command-safety hook."""

from __future__ import annotations

import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


HERE = Path(__file__).resolve().parent
INSTALLER = HERE / "install_global_hooks.py"
GUARD = HERE / "pre_tool_guard.py"


class InstallerTests(unittest.TestCase):
    def test_install_is_private_preserves_settings_and_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_home:
            home = Path(temporary_home)
            claude_settings = home / ".claude" / "settings.json"
            codex_hooks = home / ".codex" / "hooks.json"
            claude_settings.parent.mkdir(parents=True)
            codex_hooks.parent.mkdir(parents=True)

            preserved_handler = {
                "type": "command",
                "command": "echo existing-hook",
            }
            claude_settings.write_text(
                json.dumps(
                    {
                        "permissions": {"allow": ["Read"]},
                        "hooks": {
                            "PreToolUse": [
                                {
                                    "matcher": "Write",
                                    "hooks": [preserved_handler],
                                }
                            ]
                        },
                    }
                ),
                encoding="utf-8",
            )
            codex_hooks.write_text(json.dumps({"notifications": True}), encoding="utf-8")

            environment = os.environ.copy()
            environment["AGENT_GUARDRAILS_HOME"] = str(home)
            for _ in range(2):
                result = subprocess.run(
                    [sys.executable, str(INSTALLER)],
                    env=environment,
                    text=True,
                    capture_output=True,
                    check=False,
                )
                self.assertEqual(result.returncode, 0, msg=result.stderr)

            installed_guard = home / ".local" / "share" / "agent-guardrails" / "pre_tool_guard.py"
            self.assertEqual(installed_guard.read_bytes(), GUARD.read_bytes())
            self.assertEqual(stat.S_IMODE(installed_guard.stat().st_mode), 0o700)

            claude = json.loads(claude_settings.read_text(encoding="utf-8"))
            codex = json.loads(codex_hooks.read_text(encoding="utf-8"))
            self.assertEqual(claude["permissions"], {"allow": ["Read"]})
            self.assertEqual(codex["notifications"], True)
            self.assertIn(
                {"matcher": "Write", "hooks": [preserved_handler]},
                claude["hooks"]["PreToolUse"],
            )

            for document, matcher in ((claude, "Bash"), (codex, "^Bash$")):
                matching = [
                    group
                    for group in document["hooks"]["PreToolUse"]
                    if group.get("matcher") == matcher
                    and any(
                        handler.get("command", "").endswith(str(installed_guard))
                        for handler in group.get("hooks", [])
                    )
                ]
                self.assertEqual(len(matching), 1)

            backup_root = home / ".local" / "share" / "agent-guardrails" / "backups"
            self.assertEqual(len(list(backup_root.glob("*/claude-settings.json"))), 2)
            self.assertEqual(len(list(backup_root.glob("*/codex-hooks.json"))), 2)

    def test_install_creates_missing_configs(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_home:
            home = Path(temporary_home)
            environment = os.environ.copy()
            environment["AGENT_GUARDRAILS_HOME"] = str(home)
            result = subprocess.run(
                [sys.executable, str(INSTALLER)],
                env=environment,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, msg=result.stderr)
            self.assertTrue((home / ".claude" / "settings.json").is_file())
            self.assertTrue((home / ".codex" / "hooks.json").is_file())

    def test_malformed_second_config_causes_no_mutation(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_home:
            home = Path(temporary_home)
            claude_settings = home / ".claude" / "settings.json"
            codex_hooks = home / ".codex" / "hooks.json"
            claude_settings.parent.mkdir(parents=True)
            codex_hooks.parent.mkdir(parents=True)
            original_claude = b'{"permissions": {"allow": ["Read"]}}\n'
            claude_settings.write_bytes(original_claude)
            codex_hooks.write_text("not-json\n", encoding="utf-8")

            environment = os.environ.copy()
            environment["AGENT_GUARDRAILS_HOME"] = str(home)
            result = subprocess.run(
                [sys.executable, str(INSTALLER)],
                env=environment,
                text=True,
                capture_output=True,
                check=False,
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(claude_settings.read_bytes(), original_claude)
            self.assertFalse(
                (home / ".local" / "share" / "agent-guardrails" / "pre_tool_guard.py").exists()
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)
