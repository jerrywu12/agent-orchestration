#!/usr/bin/env python3
"""Safely install the shared safety hook into Claude Code and Codex."""

from __future__ import annotations

import json
import os
import shutil
import stat
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict


HOME = Path(os.environ.get("AGENT_GUARDRAILS_HOME", str(Path.home()))).expanduser().resolve()
SOURCE = Path(__file__).with_name("pre_tool_guard.py")
INSTALL_ROOT = HOME / ".local" / "share" / "agent-guardrails"
TARGET = INSTALL_ROOT / "pre_tool_guard.py"
CLAUDE_SETTINGS = HOME / ".claude" / "settings.json"
CODEX_HOOKS = HOME / ".codex" / "hooks.json"
DEFAULT_PYTHON = "/usr/bin/python3" if Path("/usr/bin/python3").is_file() else sys.executable
PYTHON = os.environ.get("AGENT_GUARDRAILS_PYTHON", DEFAULT_PYTHON)
HOOK_COMMAND = f"{PYTHON} {TARGET}"
STAMP = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
BACKUP_ROOT = INSTALL_ROOT / "backups" / STAMP


def ensure_private_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    path.chmod(0o700)


def backup(path: Path, label: str) -> None:
    if not path.exists():
        return
    ensure_private_dir(BACKUP_ROOT)
    destination = BACKUP_ROOT / label
    shutil.copy2(path, destination)
    destination.chmod(0o600)


def atomic_write_bytes(path: Path, content: bytes, mode: int) -> None:
    ensure_private_dir(path.parent)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    try:
        with os.fdopen(descriptor, "wb") as temporary:
            temporary.write(content)
            temporary.flush()
            os.fsync(temporary.fileno())
        os.chmod(temporary_name, mode)
        os.replace(temporary_name, path)
    finally:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)


def load_json(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return value


def merge_hook(document: Dict[str, Any], matcher: str) -> Dict[str, Any]:
    hooks = document.get("hooks")
    if hooks is None:
        hooks = {}
        document["hooks"] = hooks
    if not isinstance(hooks, dict):
        raise ValueError("hooks must be a JSON object")

    groups = hooks.get("PreToolUse")
    if groups is None:
        groups = []
        hooks["PreToolUse"] = groups
    if not isinstance(groups, list):
        raise ValueError("hooks.PreToolUse must be a JSON array")

    retained_groups = []
    for group in groups:
        if not isinstance(group, dict):
            raise ValueError("each PreToolUse group must be a JSON object")
        handlers = group.get("hooks")
        if not isinstance(handlers, list):
            retained_groups.append(group)
            continue
        retained_handlers = [
            handler
            for handler in handlers
            if not (
                isinstance(handler, dict)
                and isinstance(handler.get("command"), str)
                and (
                    handler["command"] == HOOK_COMMAND
                    or str(TARGET) in handler["command"]
                )
            )
        ]
        if retained_handlers:
            updated_group = dict(group)
            updated_group["hooks"] = retained_handlers
            retained_groups.append(updated_group)

    retained_groups.append(
        {
            "matcher": matcher,
            "hooks": [
                {
                    "type": "command",
                    "command": HOOK_COMMAND,
                    "timeout": 10,
                    "statusMessage": "Checking command safety",
                }
            ],
        }
    )
    hooks["PreToolUse"] = retained_groups
    return document


def write_json(path: Path, document: Dict[str, Any], default_mode: int = 0o600) -> None:
    mode = default_mode
    if path.exists():
        mode = stat.S_IMODE(path.stat().st_mode)
    serialized = (json.dumps(document, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    json.loads(serialized)
    atomic_write_bytes(path, serialized, mode)


def main() -> None:
    if not SOURCE.is_file():
        raise FileNotFoundError(SOURCE)

    source_bytes = SOURCE.read_bytes()
    claude_document = merge_hook(load_json(CLAUDE_SETTINGS), "Bash")
    codex_document = merge_hook(load_json(CODEX_HOOKS), "^Bash$")

    ensure_private_dir(INSTALL_ROOT)
    backup(CLAUDE_SETTINGS, "claude-settings.json")
    backup(CODEX_HOOKS, "codex-hooks.json")

    atomic_write_bytes(TARGET, source_bytes, 0o700)
    write_json(CLAUDE_SETTINGS, claude_document)
    write_json(CODEX_HOOKS, codex_document)

    print(f"installed_script={TARGET}")
    print(f"claude_settings={CLAUDE_SETTINGS}")
    print(f"codex_hooks={CODEX_HOOKS}")
    if BACKUP_ROOT.exists():
        print(f"backups={BACKUP_ROOT}")


if __name__ == "__main__":
    main()
