#!/usr/bin/env python3
"""Run argv once after safety inspection; retain a private log and bounded evidence."""

import argparse
import json
import math
import os
from pathlib import Path
import runpy
import shlex
import signal
import stat
import subprocess
import sys
import tempfile


OMISSION = b"\n... [output omitted; full log below] ...\n"


def max_bytes(value):
    number = int(value)
    if number < 256:
        raise argparse.ArgumentTypeError("must be at least 256 bytes")
    return number


def timeout_seconds(value):
    number = float(value)
    if not math.isfinite(number) or number <= 0:
        raise argparse.ArgumentTypeError("must be a finite positive number")
    return number


def uses_rtk(command, guard, depth=0):
    """Share the guard's wrapper parser; do not wrap an uninspected RTK action."""
    if depth > guard["MAX_RECURSION_DEPTH"]:
        raise ValueError("nested command exceeds the inspection limit")
    executable, arguments = guard["unwrap_command"](command)
    if executable == "rtk":
        return True
    if executable in guard["SHELLS"]:
        payload = guard["shell_payload"](arguments)
        if payload is not None:
            segments, _ = guard["tokenize"](payload)
            return any(uses_rtk(segment, guard, depth + 1) for segment in segments)
    return False


def inspect_safety(command):
    """The wrapper must not hide an underlying command from the shared guard."""
    directory = Path(__file__).resolve().parent
    guard = directory / "pre_tool_guard.py"
    if not os.path.lexists(guard):
        guard = directory.parent / "agent-guardrails" / "pre_tool_guard.py"
    if not guard.is_file() or not os.access(guard, os.R_OK):
        print("agent-run: required safety guard is missing or unreadable", file=sys.stderr)
        return False
    event = {"tool_name": "Bash", "tool_input": {"command": shlex.join(command)}}
    try:
        # A broken guard cannot flood agent context or allocate unlimited RAM.
        with tempfile.TemporaryFile() as evidence:
            checked = subprocess.run(
                [sys.executable, str(guard)], input=json.dumps(event).encode(),
                stdout=evidence, stderr=subprocess.STDOUT, timeout=10,
            )
            if checked.returncode != 0:
                evidence.seek(0)
                detail = evidence.read(4096).decode("utf-8", "replace")
                print("agent-run: safety guard denied or failed\n" + detail, file=sys.stderr)
                return False
        if uses_rtk(command, runpy.run_path(str(guard))):
            print("agent-run: Use original command with agent-run; "
                  "use RTK directly for read-only discovery.", file=sys.stderr)
            return False
    except (OSError, subprocess.TimeoutExpired, KeyError, TypeError, ValueError):
        print("agent-run: safety guard could not complete", file=sys.stderr)
        return False
    return True


def create_log(root):
    """Refuse an exposed or foreign log directory instead of changing its mode."""
    root = root.expanduser().absolute()
    old_umask = os.umask(0o077)
    try:
        root.mkdir(mode=0o700, parents=True, exist_ok=True)
        info = root.lstat()
        if (not stat.S_ISDIR(info.st_mode) or info.st_mode & 0o077
                or info.st_uid != os.getuid()):
            raise ValueError("log root must be an owned private directory (mode 0700)")
        descriptor, filename = tempfile.mkstemp(prefix="run-", suffix=".log", dir=root)
        os.fchmod(descriptor, 0o600)
        return os.fdopen(descriptor, "w+b"), Path(filename)
    finally:
        os.umask(old_umask)


def metadata(status, size, path):
    return f"\n[agent-run exit={status} bytes={size}]\nlog: {path}\n".encode("utf-8")


def safe_text(data, budget, tail=False):
    """Keep display valid UTF-8, even when a byte boundary splits a codepoint."""
    encoded = data.decode("utf-8", "replace").encode("utf-8")
    limited = encoded[-budget:] if tail and budget else encoded[:budget]
    return limited.decode("utf-8", "ignore").encode("utf-8")


def display(log, path, status, limit):
    size = os.fstat(log.fileno()).st_size
    details = metadata(status, size, path)
    budget = limit - len(details)
    log.seek(0)
    candidate = log.read(budget).decode("utf-8", "replace").encode("utf-8")
    if size <= budget and len(candidate) <= budget:
        preview = candidate
    else:
        available = budget - len(OMISSION)
        head_size = available // 2
        tail_size = available - head_size
        log.seek(0)
        head = safe_text(log.read(head_size), head_size)
        log.seek(-tail_size, os.SEEK_END)
        tail = safe_text(log.read(tail_size), tail_size, tail=True)
        preview = head + OMISSION + tail
    sys.stdout.buffer.write(preview + details)
    sys.stdout.buffer.flush()


def execute(command, log, timeout):
    try:
        child = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT,
                                 start_new_session=True)
    except OSError as exc:
        status = 127 if isinstance(exc, FileNotFoundError) else 126
        log.write(f"agent-run: command could not start (errno {exc.errno})\n".encode())
        log.flush()
        return status

    interrupted = []

    def stop_group():
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass

    def forward_signal(signum, frame):
        interrupted.append(signum)
        stop_group()

    previous = {sig: signal.signal(sig, forward_signal)
                for sig in (signal.SIGINT, signal.SIGTERM)}
    try:
        try:
            status = child.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            stop_group()
            child.wait()
            return 124
        if interrupted:
            return 128 + interrupted[0]
        return 128 - status if status < 0 else status
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--max-bytes", type=max_bytes, default=8000,
                        help="total displayed stdout byte budget (minimum 256)")
    parser.add_argument("--log-root", type=Path,
                        default=Path.home() / ".local/state/agent-efficiency/logs")
    parser.add_argument("--timeout", type=timeout_seconds)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    options = parser.parse_args(argv)
    command = options.command
    if command and command[0] == "--":
        command = command[1:]
    if not command:
        parser.error("provide a command after --")
    try:
        if not inspect_safety(command):
            return 2
        log, path = create_log(options.log_root)
        with log:
            # Reserve realistic maximum status/size widths before starting a command.
            required = len(metadata(255, 10**20, path)) + len(OMISSION) + 8
            if required > options.max_bytes:
                raise ValueError("--max-bytes is too small for the log path; increase it")
            status = execute(command, log, options.timeout)
            display(log, path, status, options.max_bytes)
            return status
    except (OSError, ValueError) as exc:
        print(f"agent-run: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
