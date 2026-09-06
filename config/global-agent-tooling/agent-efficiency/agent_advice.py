#!/usr/bin/env python3
"""Request one bounded advisory response using existing provider identity.

No tool calls, model pulls, credential setup, provider fallback or execution of
the returned text. The caller is responsible for choosing safe prompt content.
"""

import argparse
import http.client
import json
import math
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request


INSTRUCTIONS = (
    "Give concise development advice for this one question. State uncertainty "
    "and concrete evidence needed. Do not call tools or claim to have changed "
    "files or run checks. The lead agent owns execution and verification."
)
MAX_RESPONSE_BYTES = 1024 * 1024
USAGE_KEYS = {
    "input_tokens", "output_tokens", "prompt_tokens", "completion_tokens",
    "total_tokens", "cached_tokens", "reasoning_tokens", "input_tokens_details",
    "output_tokens_details", "prompt_tokens_details", "completion_tokens_details",
}


class AdviceError(Exception):
    def __init__(self, message, code=1):
        super().__init__(message)
        self.code = code


def integer_limit(low, high):
    def parse(value):
        try:
            number = int(value)
        except ValueError:
            raise argparse.ArgumentTypeError("must be an integer") from None
        if not low <= number <= high:
            raise argparse.ArgumentTypeError("must be between %s and %s" % (low, high))
        return number
    return parse


def timeout_seconds(value):
    try:
        number = float(value)
    except ValueError:
        raise argparse.ArgumentTypeError("timeout must be a number") from None
    if not math.isfinite(number) or not 0 < number <= 600:
        raise argparse.ArgumentTypeError("timeout must be greater than 0 and at most 600 seconds")
    return number


def read_prompt(path, maximum):
    try:
        if not path.is_file():
            raise AdviceError("prompt-file must be a regular readable file", 2)
        with path.open("rb") as handle:
            raw = handle.read(maximum + 1)
    except OSError:
        raise AdviceError("cannot read prompt-file", 2) from None
    if len(raw) > maximum:
        raise AdviceError("prompt exceeds the %s byte input limit" % maximum, 2)
    try:
        prompt = raw.decode("utf-8")
    except UnicodeError:
        raise AdviceError("prompt-file must contain UTF-8 text", 2) from None
    if not prompt.strip() or "\x00" in prompt:
        raise AdviceError("prompt-file must contain nonempty text without NUL bytes", 2)
    return prompt


def decode_response(raw, provider):
    if len(raw) > MAX_RESPONSE_BYTES:
        raise AdviceError("%s response exceeds the local byte limit" % provider)
    try:
        document = json.loads(raw)
    except (ValueError, UnicodeError):
        raise AdviceError("%s returned invalid JSON" % provider) from None
    if not isinstance(document, dict) or document.get("error"):
        raise AdviceError("%s returned an unsuccessful response" % provider)
    return document


def token_usage(value, depth=0):
    """Expose token counts only, excluding arbitrary provider diagnostic fields."""
    if not isinstance(value, dict) or depth > 2:
        return {}
    result = {}
    for key in USAGE_KEYS:
        item = value.get(key)
        if isinstance(item, int) and not isinstance(item, bool) and item >= 0:
            result[key] = item
        elif isinstance(item, dict):
            nested = token_usage(item, depth + 1)
            if nested:
                result[key] = nested
    return result


def answer(document, provider, requested_model, content, usage):
    if not isinstance(content, str) or not content.strip():
        raise AdviceError("%s did not return an answer" % provider)
    result = {"provider": provider, "content": content, "usage": token_usage(usage)}
    model = document.get("model") or requested_model
    if isinstance(model, str):
        result["model"] = model
    return result


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        return None


class DeadlineSocket(socket.socket):
    """Recompute remaining time for each socket read, including HTTP headers."""

    def set_remaining(self):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("request deadline exceeded")
        self.settimeout(remaining)

    def recv_into(self, *args):
        self.set_remaining()
        return super().recv_into(*args)

    def sendall(self, *args):
        self.set_remaining()
        return super().sendall(*args)


class DeadlineHTTPConnection(http.client.HTTPConnection):
    def __init__(self, *args, deadline, **kwargs):
        super().__init__(*args, **kwargs)
        self.deadline = deadline
        self._create_connection = self.connect_socket

    def connect_socket(self, address, timeout=None, source_address=None):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("request deadline exceeded")
        host, port = address
        # A numeric loopback address avoids a DNS lookup outside this deadline.
        address = ("127.0.0.1" if host == "localhost" else host, port)
        raw = socket.create_connection(address, remaining, source_address)
        bounded = DeadlineSocket(raw.family, raw.type, raw.proto, fileno=raw.detach())
        bounded.deadline = self.deadline
        return bounded


class DeadlineHTTPHandler(urllib.request.HTTPHandler):
    def __init__(self, deadline):
        super().__init__()
        self.deadline = deadline

    def http_open(self, request):
        def connection(host, **kwargs):
            return DeadlineHTTPConnection(host, deadline=self.deadline, **kwargs)
        return self.do_open(connection, request)


def ollama_advice(args, prompt):
    base = os.environ.get("AGENT_ADVICE_OLLAMA_URL", "http://127.0.0.1:11434")
    try:
        parsed = urllib.parse.urlsplit(base)
        port = parsed.port  # Reject malformed ports before making a request.
        valid = (
            parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost", "::1"}
            and parsed.username is None and parsed.password is None
            and parsed.path in {"", "/"} and not parsed.query and not parsed.fragment
            and (port is None or port > 0)
        )
    except ValueError:
        valid = False
    if not valid:
        raise AdviceError("AGENT_ADVICE_OLLAMA_URL must be an HTTP loopback origin", 2)
    payload = {
        "model": args.model,
        "stream": False,
        "messages": [{"role": "system", "content": INSTRUCTIONS}, {"role": "user", "content": prompt}],
        "options": {"num_predict": args.max_output_tokens},
    }
    request = urllib.request.Request(
        base.rstrip("/") + "/api/chat", data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST",
    )
    deadline = time.monotonic() + args.timeout
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({}), NoRedirect(), DeadlineHTTPHandler(deadline),
    )
    try:
        with opener.open(request, timeout=args.timeout) as response:
            raw = bytearray()
            while len(raw) <= MAX_RESPONSE_BYTES:
                if time.monotonic() >= deadline:
                    raise TimeoutError("request deadline exceeded")
                chunk = response.read1(min(65536, MAX_RESPONSE_BYTES + 1 - len(raw)))
                if not chunk:
                    break
                raw.extend(chunk)
    except urllib.error.HTTPError as exc:
        raise AdviceError("ollama request failed (HTTP %s); no retry or model pull" % exc.code) from None
    except (socket.timeout, TimeoutError):
        raise AdviceError("ollama request timeout", 124) from None
    except urllib.error.URLError as exc:
        if isinstance(exc.reason, (socket.timeout, TimeoutError)):
            raise AdviceError("ollama request timeout", 124) from None
        raise AdviceError("ollama connection failed; no fallback") from None
    except (OSError, http.client.HTTPException):
        raise AdviceError("ollama transport failed; no fallback") from None
    document = decode_response(raw, "ollama")
    message = document.get("message")
    if not isinstance(message, dict) or message.get("tool_calls") or document.get("done") is False:
        raise AdviceError("ollama returned an incomplete response or tool request")
    usage = {"prompt_tokens": document.get("prompt_eval_count"), "completion_tokens": document.get("eval_count")}
    return answer(document, "ollama", args.model, message.get("content"), usage)


def stop_child(child):
    if os.name == "posix":
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    elif child.poll() is None:
        child.kill()


def arkcli_advice(args, prompt):
    command = [
        os.environ.get("AGENT_ADVICE_ARKCLI", "arkcli"), "+chat", "--no-progress",
        "--format", "json", "--tool-choice", "none", "--instructions", INSTRUCTIONS,
        "--max-output-tokens", str(args.max_output_tokens),
    ]
    if args.model:
        command.extend(["--model", args.model])
    if args.profile:
        command.extend(["--profile", args.profile])
    command.extend(["--", prompt])
    environment = os.environ.copy()
    environment.update({
        "ARKCLI_NO_UPDATE_NOTIFIER": "1", "ARKCLI_CALLER_TYPE": "ai_agent",
        "ARKCLI_CALLER_NAME": "agent-efficiency", "ARKCLI_SKILL_NAME": "arkcli-chat",
    })
    child = None
    interrupted = None

    def on_signal(signum, frame):
        nonlocal interrupted
        interrupted = signum
        if child is not None:
            stop_child(child)

    previous = {sig: signal.signal(sig, on_signal) for sig in (signal.SIGINT, signal.SIGTERM)}
    try:
        # Private transient output; raw CLI stderr may include credentials and is
        # intentionally discarded. Never log a prompt-bearing command line.
        with tempfile.TemporaryFile() as output:
            child = subprocess.Popen(
                command, env=environment, stdin=subprocess.DEVNULL, stdout=output,
                stderr=subprocess.DEVNULL, start_new_session=(os.name == "posix"),
            )
            if interrupted is not None:
                stop_child(child)
            try:
                child.wait(timeout=args.timeout)
            except subprocess.TimeoutExpired:
                # The npm entry point spawns a native CLI. Cancel both on POSIX
                # so a reported timeout cannot leave that request running.
                stop_child(child)
                child.wait()
                raise
            if interrupted is not None:
                raise AdviceError("arkcli request interrupted", 128 + interrupted)
            if child.returncode:
                code = child.returncode if child.returncode > 0 else 128 - child.returncode
                raise AdviceError("arkcli failed with exit status %s; no retry or fallback" % code, code)
            output.seek(0)
            raw = output.read(MAX_RESPONSE_BYTES + 1)
    except FileNotFoundError:
        raise AdviceError("arkcli executable unavailable", 127) from None
    except subprocess.TimeoutExpired:
        raise AdviceError("arkcli request timeout", 124) from None
    except OSError:
        raise AdviceError("cannot execute arkcli", 126) from None
    finally:
        if child is not None and child.poll() is None:
            stop_child(child)
            child.wait()
        for sig, handler in previous.items():
            signal.signal(sig, handler)
    document = decode_response(raw, "arkcli")
    if document.get("function_calls") or document.get("status") in {"failed", "incomplete", "cancelled"}:
        raise AdviceError("arkcli returned an incomplete response or tool request")
    return answer(document, "arkcli", args.model, document.get("content"), document.get("usage"))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--provider", choices=("ollama", "arkcli"), required=True)
    parser.add_argument("--model", help="Required for Ollama; ArkCLI otherwise uses the existing profile default")
    parser.add_argument("--profile", help="Existing ArkCLI profile for this invocation only")
    parser.add_argument("--prompt-file", type=Path, required=True)
    parser.add_argument("--max-input-bytes", type=integer_limit(1, 65536), default=16384)
    parser.add_argument("--max-output-tokens", type=integer_limit(1, 4096), default=512)
    parser.add_argument("--timeout", type=timeout_seconds, default=120)
    args = parser.parse_args(argv)
    if args.provider == "ollama" and (not args.model or args.profile):
        parser.error("ollama requires --model and does not accept --profile")
    for field in (args.model, args.profile):
        if field is not None and (not field.strip() or "\x00" in field):
            parser.error("model and profile must be nonempty text without NUL bytes")
    try:
        prompt = read_prompt(args.prompt_file, args.max_input_bytes)
        result = ollama_advice(args, prompt) if args.provider == "ollama" else arkcli_advice(args, prompt)
    except AdviceError as exc:
        print("agent-advice: %s" % exc, file=sys.stderr)
        return exc.code
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
