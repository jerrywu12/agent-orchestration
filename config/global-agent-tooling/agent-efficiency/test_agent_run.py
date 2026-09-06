"""Black-box contract tests for the private, bounded command runner."""

import concurrent.futures
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest


RUNNER = Path(__file__).with_name("agent_run.py")


class AgentRunTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="agent-run-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.logs = self.root / "logs"

    def script(self, source, name="child.py"):
        script = self.root / name
        script.write_text(source)
        return [sys.executable, str(script)]

    def run_command(self, command, options=(), runner=RUNNER, **kwargs):
        return subprocess.run(
            [sys.executable, str(runner), "--log-root", str(self.logs),
             *options, "--", *command],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10, **kwargs,
        )

    def log(self, result):
        match = re.search(rb"^log: (.+)$", result.stdout, re.MULTILINE)
        self.assertIsNotNone(match, result.stdout)
        return Path(os.fsdecode(match.group(1)))

    def test_combined_complete_log_and_nonzero_status(self):
        result = self.run_command(self.script(
            "import os, sys\nos.write(1, b'first\\n')\n"
            "os.write(2, b'second\\n')\nsys.exit(7)\n"
        ))
        self.assertEqual(result.returncode, 7, result.stderr)
        self.assertEqual(self.log(result).read_bytes(), b"first\nsecond\n")
        self.assertIn(b"exit=7", result.stdout)
        self.assertEqual(result.stderr, b"")

    def test_large_single_line_unicode_is_bounded_with_full_raw_log(self):
        payload = ("prefix|" + "汉😀é" * 100000 + "|tail").encode()
        data = self.root / "payload.bin"
        data.write_bytes(payload)
        result = self.run_command(
            self.script("import shutil, sys\n"
                        "with open(sys.argv[1], 'rb') as f: shutil.copyfileobj(f, sys.stdout.buffer)\n")
            + [str(data)], options=("--max-bytes", "1000"),
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertLessEqual(len(result.stdout), 1000)
        result.stdout.decode("utf-8")
        self.assertIn(b"prefix|", result.stdout)
        self.assertIn(b"|tail", result.stdout)
        self.assertIn(b"omitted", result.stdout)
        self.assertEqual(self.log(result).read_bytes(), payload)

    def test_default_cap_and_small_cap(self):
        command = self.script("import sys\nsys.stdout.write('x' * 100000)\n")
        for options, limit in (((), 8000), (("--max-bytes", "256"), 256)):
            with self.subTest(limit=limit):
                result = self.run_command(command, options=options)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertLessEqual(len(result.stdout), limit)
                self.assertEqual(len(self.log(result).read_bytes()), 100000)

    def test_invalid_cap_or_timeout_does_not_execute(self):
        marker = self.root / "ran"
        command = self.script(f"from pathlib import Path\nPath({str(marker)!r}).touch()\n")
        for options in (("--max-bytes", "255"), ("--timeout", "0"),
                        ("--timeout", "nan"), ("--timeout", "inf")):
            result = self.run_command(command, options=options)
            self.assertEqual(result.returncode, 2)
            self.assertFalse(marker.exists())

    def test_argv_cwd_fidelity_and_only_one_execution(self):
        work = self.root / "a project"
        work.mkdir()
        command = self.script(
            "import json, os, sys\n"
            "with open('calls', 'a') as f: f.write('once\\n')\n"
            "print(json.dumps({'cwd': os.getcwd(), 'args': sys.argv[1:]}))\n"
        )
        args = ["", "two words", "*", "$HOME", "$(echo surprise)", "`echo surprise`", "é"]
        result = self.run_command(command + args, cwd=work)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(self.log(result).read_bytes()),
                         {"cwd": str(work.resolve()), "args": args})
        self.assertEqual((work / "calls").read_text(), "once\n")

    @unittest.skipUnless(os.name == "posix", "child umask requires POSIX")
    def test_child_artifact_preserves_inherited_umask(self):
        self.logs = self.root / "private" / "logs"
        result = self.run_command(self.script(
            "from pathlib import Path\nPath('artifact').write_text('created')\n"
        ), cwd=self.root, umask=0o022)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.root / "artifact").stat().st_mode & 0o777, 0o644)
        self.assertEqual(self.logs.stat().st_mode & 0o777, 0o700)
        self.assertEqual(self.logs.parent.stat().st_mode & 0o777, 0o700)
        self.assertEqual(self.log(result).stat().st_mode & 0o777, 0o600)

    def test_exit_status_missing_and_child_signal(self):
        missing = self.run_command([str(self.root / "does-not-exist")])
        self.assertEqual(missing.returncode, 127, missing.stderr)
        self.assertIn(b"exit=127", missing.stdout)
        signaled = self.run_command(self.script(
            "import os, signal\nos.kill(os.getpid(), signal.SIGTERM)\n"
        ))
        self.assertEqual(signaled.returncode, 128 + signal.SIGTERM)

    @unittest.skipUnless(os.name == "posix", "process groups require POSIX")
    def test_timeout_kills_child_and_grandchild_and_keeps_output(self):
        survivor = self.root / "survived"
        child = self.script(
            "import subprocess, sys, time\n"
            "print('before timeout', flush=True)\n"
            "subprocess.Popen([sys.executable, sys.argv[1], sys.argv[2]])\n"
            "time.sleep(30)\n"
        )
        grandchild = self.script(
            "import pathlib, sys, time\ntime.sleep(0.6)\n"
            "pathlib.Path(sys.argv[1]).write_text('escaped')\n", "grandchild.py",
        )[1]
        start = time.monotonic()
        result = self.run_command(child + [grandchild, str(survivor)],
                                  options=("--timeout", "0.15"))
        self.assertEqual(result.returncode, 124, result.stderr)
        self.assertLess(time.monotonic() - start, 2)
        self.assertEqual(self.log(result).read_bytes(), b"before timeout\n")
        time.sleep(0.7)
        self.assertFalse(survivor.exists())

    def test_concurrent_logs_are_unique_private_and_complete(self):
        command = self.script("import sys\nprint(sys.argv[1] * 5000)\n")
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda n: self.run_command(command + [str(n)]), range(4)))
        paths = [self.log(result) for result in results]
        self.assertEqual(len(set(paths)), 4)
        self.assertEqual(self.logs.stat().st_mode & 0o777, 0o700)
        for n, (result, path) in enumerate(zip(results, paths)):
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(path.read_text(), str(n) * 5000 + "\n")

    def test_metadata_does_not_copy_command_arguments(self):
        result = self.run_command(self.script("pass\n") + ["secret=not-for-metadata"])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn(b"not-for-metadata", result.stdout + result.stderr)
        self.assertEqual(self.log(result).read_bytes(), b"")

    def test_invalid_utf8_expansion_still_marks_omission(self):
        result = self.run_command(self.script("import os\nos.write(1, b'\\xff' * 300)\n"),
                                  options=("--max-bytes", "600"))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertLessEqual(len(result.stdout), 600)
        self.assertIn(b"omitted", result.stdout)
        result.stdout.decode("utf-8")
        self.assertEqual(self.log(result).read_bytes(), b"\xff" * 300)

    def test_unsafe_log_root_fails_before_execution(self):
        self.logs.mkdir(mode=0o755)
        self.logs.chmod(0o755)
        marker = self.root / "ran"
        result = self.run_command(self.script(
            f"from pathlib import Path\nPath({str(marker)!r}).touch()\n"
        ))
        self.assertEqual(result.returncode, 2)
        self.assertFalse(marker.exists())
        self.assertEqual(self.logs.stat().st_mode & 0o777, 0o755)

    @unittest.skipUnless(os.name == "posix", "process groups require POSIX")
    def test_wrapper_sigterm_kills_group_and_reports_signal(self):
        self.check_wrapper_sigterm()

    @unittest.skipUnless(os.name == "posix", "process groups require POSIX")
    def test_wrapper_sigterm_kills_grandchild_after_its_parent_exits(self):
        self.check_wrapper_sigterm(shell=True)

    def check_wrapper_sigterm(self, shell=False):
        ready = self.root / "ready"
        survivor = self.root / "survived"
        command = self.script(
            "import pathlib, sys, time\n"
            "pathlib.Path(sys.argv[1]).touch()\n"
            "time.sleep(0.6)\n"
            "pathlib.Path(sys.argv[2]).touch()\n"
        ) + [str(ready), str(survivor)]
        if shell:
            intermediate = self.script(
                "import subprocess, sys\n"
                "subprocess.Popen([sys.executable, *sys.argv[1:]])\n",
                "intermediate.py",
            )
            command = ["sh", "-c", shlex.join(intermediate + command[1:]) + "; sleep 30"]
        proc = subprocess.Popen(
            [sys.executable, str(RUNNER), "--log-root", str(self.logs), "--", *command],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        try:
            deadline = time.monotonic() + 5
            while not ready.exists() and proc.poll() is None and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertTrue(ready.exists())
            proc.send_signal(signal.SIGTERM)
            stdout, stderr = proc.communicate(timeout=2)
            self.assertEqual(proc.returncode, 143, stderr)
            self.assertIn(b"exit=143", stdout)
            time.sleep(0.7)
            self.assertFalse(survivor.exists())
        finally:
            if proc.poll() is None:
                proc.kill()
                proc.communicate()

    def isolated_runner(self):
        isolated = self.root / "installation"
        isolated.mkdir()
        shutil.copy2(RUNNER, isolated / RUNNER.name)
        return isolated / RUNNER.name

    def test_real_guard_blocks_reset_before_child_runs(self):
        result = self.run_command(["git", "reset", "--hard"], cwd=self.root)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, b"")
        self.assertIn(b"BLOCKED", result.stderr)
        self.assertNotIn(b"not a git repository", result.stderr)

    def test_rtk_direct_and_common_wrappers_never_execute(self):
        marker = self.root / "rtk-executed"
        fake_rtk = self.root / "rtk"
        fake_rtk.write_text(
            f"#!{sys.executable}\nfrom pathlib import Path\n"
            f"Path({str(marker)!r}).touch()\n"
        )
        fake_rtk.chmod(0o700)
        args = [str(fake_rtk), "git", "reset", "--hard"]
        commands = [args, ["env", "EXAMPLE=1", *args], ["nohup", *args],
                    ["time", *args], ["timeout", "3", *args],
                    ["stdbuf", "-oL", *args], ["env", "nohup", *args],
                    ["env", "-S", shlex.join(args)],
                    ["sh", "-c", shlex.join(args)]]
        for command in commands:
            with self.subTest(command=command):
                result = self.run_command(command)
                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertEqual(result.stdout, b"")
                self.assertIn(b"Use original command with agent-run", result.stderr)
                self.assertFalse(marker.exists())

    def test_missing_or_invalid_guard_fails_closed(self):
        runner = self.isolated_runner()
        marker = self.root / "ran"
        command = self.script(f"from pathlib import Path\nPath({str(marker)!r}).touch()\n")
        for contents in (None, "this is invalid python\n", "raise SystemExit(3)\n"):
            if contents is not None:
                runner.with_name("pre_tool_guard.py").write_text(contents)
            result = self.run_command(command, runner=runner)
            self.assertEqual(result.returncode, 2)
            self.assertEqual(result.stdout, b"")
            self.assertFalse(marker.exists())


if __name__ == "__main__":
    unittest.main()
