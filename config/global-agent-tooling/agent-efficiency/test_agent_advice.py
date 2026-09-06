"""Synthetic provider contracts; never call a live model or inspect credentials."""

import contextlib
import http.server
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest


SCRIPT = Path(__file__).with_name("agent_advice.py")


@contextlib.contextmanager
def fake_ollama(payload, status=200, redirect=None, drip=None):
    calls = []

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_POST(self):
            calls.append((self.path, json.loads(self.rfile.read(int(self.headers["Content-Length"])))))
            body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
            if drip:
                header = b"HTTP/1.0 200 OK\r\nX-Slow: 1234567890\r\n\r\n"
                chunks = [header, *[body[i:i + 8] for i in range(0, len(body), 8)]]
                if drip == "headers":
                    chunks = [*[header[i:i + 4] for i in range(0, len(header), 4)], body]
                try:
                    for chunk in chunks:
                        self.wfile.write(chunk)
                        self.wfile.flush()
                        time.sleep(.1)
                except (BrokenPipeError, ConnectionResetError):
                    pass
                return
            self.send_response(status)
            if redirect:
                self.send_header("Location", redirect)
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield "http://127.0.0.1:%s" % server.server_port, calls
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


class AdviceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.prompt = self.root / "prompt.txt"
        self.prompt.write_text("Assess one small change. Do not execute commands.", encoding="utf-8")
        self.environment = os.environ.copy()
        self.environment["AGENT_ADVICE_ARKCLI"] = str(self.root / "missing-arkcli")

    def run_advice(self, provider, *arguments, env=None):
        return subprocess.run(
            [sys.executable, str(SCRIPT), "--provider", provider, "--prompt-file", str(self.prompt), *arguments],
            env=dict(self.environment, **(env or {})), capture_output=True, text=True, timeout=10,
        )

    def fake_arkcli(self, payload=None, code=0, delay=0):
        executable = self.root / "fake-arkcli"
        capture = self.root / "capture.json"
        executable.write_text(
            "#!%s\n" % sys.executable
            + "import json, os, sys, time\n"
            + "from pathlib import Path\n"
            + "Path(%r).write_text(json.dumps({'argv':sys.argv[1:], 'env': {k: os.environ.get(k) for k in ['ARKCLI_NO_UPDATE_NOTIFIER','ARKCLI_CALLER_TYPE','ARKCLI_CALLER_NAME','ARKCLI_SKILL_NAME']}}))\n" % str(capture)
            + "time.sleep(%r)\n" % delay
            + "print(%r)\n" % (payload if isinstance(payload, str) else json.dumps(payload or {"content": "Useful advice.", "usage": {"prompt_tokens": 4, "completion_tokens": 3}}))
            + "print('SECRET_SENTINEL provider stderr', file=sys.stderr)\n"
            + "sys.exit(%d)\n" % code,
            encoding="utf-8",
        )
        executable.chmod(0o700)
        self.environment["AGENT_ADVICE_ARKCLI"] = str(executable)
        return capture

    def test_ollama_request_uses_bounded_advice_without_proxy_or_tools(self):
        with fake_ollama({"model": "test-model", "done": True, "message": {"content": "Review the boundary."}, "prompt_eval_count": 8, "eval_count": 5}) as (url, calls):
            result = self.run_advice("ollama", "--model", "test-model", env={"AGENT_ADVICE_OLLAMA_URL": url, "http_proxy": "http://127.0.0.1:1", "HTTP_PROXY": "http://127.0.0.1:1", "NO_PROXY": "", "no_proxy": ""})
        self.assertEqual(result.returncode, 0, result.stderr)
        output = json.loads(result.stdout)
        self.assertEqual(output["content"], "Review the boundary.")
        self.assertEqual(output["usage"], {"prompt_tokens": 8, "completion_tokens": 5})
        self.assertEqual(len(calls), 1)
        path, payload = calls[0]
        self.assertEqual(path, "/api/chat")
        self.assertFalse(payload["stream"])
        self.assertEqual(payload["options"]["num_predict"], 512)
        self.assertEqual(payload["messages"][1]["content"], self.prompt.read_text())
        self.assertNotIn("tools", payload)

    def test_ollama_requires_explicit_model_before_request(self):
        with fake_ollama({}) as (url, calls):
            result = self.run_advice("ollama", env={"AGENT_ADVICE_OLLAMA_URL": url})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("model", result.stderr)
        self.assertEqual(calls, [])

    def test_ollama_unknown_model_failure_does_not_retry_or_pull(self):
        with fake_ollama({"error": "SECRET_SENTINEL unknown model"}, status=404) as (url, calls):
            result = self.run_advice("ollama", "--model", "missing", env={"AGENT_ADVICE_OLLAMA_URL": url})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("404", result.stderr)
        self.assertNotIn("SECRET_SENTINEL", result.stdout + result.stderr)
        self.assertEqual(len(calls), 1)

    def test_ollama_rejects_nonlocal_url_and_redirect(self):
        for url in ["https://example.com", "http://127.0.0.1@example.com", "http://127.0.0.1:1/path", "http://127.0.0.1:1?token=SECRET_SENTINEL"]:
            with self.subTest(url=url):
                result = self.run_advice("ollama", "--model", "test", env={"AGENT_ADVICE_OLLAMA_URL": url})
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn("SECRET_SENTINEL", result.stderr)
        with fake_ollama({}, status=307, redirect="http://example.com") as (url, calls):
            result = self.run_advice("ollama", "--model", "test", env={"AGENT_ADVICE_OLLAMA_URL": url})
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(len(calls), 1)

    def test_ollama_invalid_or_nonanswer_response_is_failure(self):
        for response in [b"SECRET_SENTINEL not-json", [], {"error": "SECRET_SENTINEL"}, {"message": {"thinking": "reasoning only"}}, {"message": {"content": "partial"}, "done": False}, {"message": {"content": "answer", "tool_calls": [{"name": "run"}]}}]:
            with self.subTest(response=response):
                with fake_ollama(response) as (url, calls):
                    result = self.run_advice("ollama", "--model", "test", env={"AGENT_ADVICE_OLLAMA_URL": url})
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn("SECRET_SENTINEL", result.stdout + result.stderr)

    def test_arkcli_preserves_argv_attribution_and_budgets(self):
        capture = self.fake_arkcli()
        self.prompt.write_text("--dangerous-looking prompt with `backticks` and $(text)", encoding="utf-8")
        result = self.run_advice("arkcli", "--model", "ep-exact-model", "--profile", "existing profile", "--max-output-tokens", "123")
        self.assertEqual(result.returncode, 0, result.stderr)
        output = json.loads(result.stdout)
        self.assertEqual(output["content"], "Useful advice.")
        self.assertEqual(output["usage"]["completion_tokens"], 3)
        recorded = json.loads(capture.read_text())
        argv = recorded["argv"]
        self.assertEqual(argv[0], "+chat")
        self.assertEqual(argv[-2:], ["--", self.prompt.read_text()])
        for flag, value in [("--model", "ep-exact-model"), ("--profile", "existing profile"), ("--max-output-tokens", "123"), ("--format", "json"), ("--tool-choice", "none")]:
            self.assertEqual(argv[argv.index(flag) + 1], value)
        self.assertIn("--no-progress", argv)
        self.assertNotIn("--store", argv)
        self.assertNotIn("--api-key", argv)
        self.assertEqual(recorded["env"], {"ARKCLI_NO_UPDATE_NOTIFIER": "1", "ARKCLI_CALLER_TYPE": "ai_agent", "ARKCLI_CALLER_NAME": "agent-efficiency", "ARKCLI_SKILL_NAME": "arkcli-chat"})

    def test_arkcli_no_model_uses_existing_profile_default(self):
        capture = self.fake_arkcli()
        result = self.run_advice("arkcli")
        self.assertEqual(result.returncode, 0, result.stderr)
        argv = json.loads(capture.read_text())["argv"]
        self.assertNotIn("--model", argv)
        self.assertNotIn("--profile", argv)

    def test_arkcli_failure_retains_code_without_leaking_diagnostics(self):
        self.fake_arkcli(payload="SECRET_SENTINEL", code=7)
        result = self.run_advice("arkcli")
        self.assertEqual(result.returncode, 7)
        self.assertIn("7", result.stderr)
        self.assertNotIn("SECRET_SENTINEL", result.stdout + result.stderr)

    def test_arkcli_invalid_json_thinking_only_and_tool_calls_are_failures(self):
        for payload in ["SECRET_SENTINEL", [], {"reasoning_content": "only reasoning"}, {"content": "", "usage": {}}, {"content": "Do it", "function_calls": [{"name": "run"}]}]:
            with self.subTest(payload=payload):
                self.fake_arkcli(payload=json.dumps(payload))
                result = self.run_advice("arkcli")
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn("SECRET_SENTINEL", result.stdout + result.stderr)

    def test_input_byte_limit_rejected_before_provider_invocation(self):
        capture = self.fake_arkcli()
        self.prompt.write_text("é" * 8193, encoding="utf-8")
        result = self.run_advice("arkcli")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("16384", result.stderr)
        self.assertFalse(capture.exists())

    def test_validation_rejects_empty_binary_prompt_and_invalid_limits(self):
        capture = self.fake_arkcli()
        for content in [b" ", b"\xff", b"hello\x00world"]:
            self.prompt.write_bytes(content)
            self.assertNotEqual(self.run_advice("arkcli").returncode, 0)
        self.prompt.write_text("hello")
        for args in [("--max-output-tokens", "0"), ("--max-output-tokens", "4097"), ("--max-input-bytes", "0"), ("--timeout", "0"), ("--timeout", "nan")]:
            with self.subTest(args=args):
                self.assertNotEqual(self.run_advice("arkcli", *args).returncode, 0)
        self.assertFalse(capture.exists())

    def test_missing_executable_and_timeout_have_clear_failure_status(self):
        self.assertEqual(self.run_advice("arkcli").returncode, 127)
        self.fake_arkcli(delay=1)
        result = self.run_advice("arkcli", "--timeout", "0.05")
        self.assertEqual(result.returncode, 124)
        self.assertIn("timeout", result.stderr)

    def test_ollama_deadline_bounds_dripping_headers_and_body(self):
        for drip in ("headers", "body"):
            with self.subTest(drip=drip):
                with fake_ollama({"message": {"content": "slow but steady answer"}}, drip=drip) as (url, calls):
                    before = time.monotonic()
                    result = self.run_advice("ollama", "--model", "test", "--timeout", ".3", env={"AGENT_ADVICE_OLLAMA_URL": url})
                    elapsed = time.monotonic() - before
                self.assertEqual(result.returncode, 124, result.stderr)
                self.assertLess(elapsed, .9, "inactivity timeout did not enforce a wall-clock deadline")
                self.assertEqual(len(calls), 1)

    @unittest.skipUnless(os.name == "posix", "process-group cleanup is a POSIX contract")
    def test_interrupt_terminates_native_child_of_cli_wrapper(self):
        for interrupt in (signal.SIGTERM, signal.SIGINT):
            with self.subTest(interrupt=interrupt):
                started = self.root / ("started-%s" % interrupt)
                marker = self.root / ("finished-%s" % interrupt)
                executable = self.root / "fake-arkcli"
                child = "import time; from pathlib import Path; Path(%r).write_text('started'); time.sleep(.8); Path(%r).write_text('still running')" % (str(started), str(marker))
                executable.write_text("#!%s\nimport subprocess, sys, time\nsubprocess.Popen([sys.executable, '-c', %r])\ntime.sleep(2)\n" % (sys.executable, child), encoding="utf-8")
                executable.chmod(0o700)
                self.environment["AGENT_ADVICE_ARKCLI"] = str(executable)
                process = subprocess.Popen([sys.executable, str(SCRIPT), "--provider", "arkcli", "--prompt-file", str(self.prompt)], env=self.environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                try:
                    deadline = time.monotonic() + 4
                    while not started.exists() and time.monotonic() < deadline:
                        time.sleep(.02)
                    self.assertTrue(started.exists(), "fixture child did not start")
                    process.send_signal(interrupt)
                    process.communicate(timeout=3)
                    time.sleep(1)
                    self.assertFalse(marker.exists(), "native CLI child survived cancellation")
                    self.assertEqual(process.returncode, 128 + interrupt)
                finally:
                    if process.poll() is None:
                        process.kill()
                    process.communicate()

    @unittest.skipUnless(os.name == "posix", "process-group cleanup is a POSIX contract")
    def test_timeout_terminates_native_child_of_cli_wrapper(self):
        marker = self.root / "child-finished"
        started = self.root / "child-started"
        executable = self.root / "fake-arkcli"
        child = "import time; from pathlib import Path; Path(%r).write_text('started'); time.sleep(1.5); Path(%r).write_text('still running')" % (str(started), str(marker))
        executable.write_text(
            "#!%s\nimport subprocess, sys, time\nsubprocess.Popen([sys.executable, '-c', %r])\ntime.sleep(2)\n" % (sys.executable, child),
            encoding="utf-8",
        )
        executable.chmod(0o700)
        self.environment["AGENT_ADVICE_ARKCLI"] = str(executable)
        result = self.run_advice("arkcli", "--timeout", "1")
        self.assertEqual(result.returncode, 124)
        self.assertTrue(started.exists(), "fixture child did not reach its starting boundary")
        threading.Event().wait(1)
        self.assertFalse(marker.exists(), "a native CLI child survived the timeout")


if __name__ == "__main__":
    unittest.main()
