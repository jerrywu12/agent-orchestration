#!/usr/bin/env python3
"""Global PreToolUse guard for Claude Code and Codex Bash tool calls."""

from __future__ import annotations

import json
import os
import re
import shlex
import sys
from dataclasses import dataclass
from typing import List, Optional, Sequence, Tuple


MAX_COMMAND_BYTES = 128 * 1024
MAX_EVENT_BYTES = 256 * 1024
MAX_RECURSION_DEPTH = 4
CONTROL_CHARS = frozenset(";&|()`\n")
SHELLS = {"bash", "dash", "ksh", "sh", "zsh"}
INLINE_INTERPRETERS = {"node", "nodejs", "perl", "php", "python", "python3", "ruby"}
SHELL_FLOW_KEYWORDS = {
    "!",
    "{",
    "}",
    "case",
    "do",
    "done",
    "elif",
    "else",
    "esac",
    "fi",
    "for",
    "if",
    "in",
    "select",
    "then",
    "until",
    "while",
}
OPAQUE_SHELL_KEYWORDS = {"coproc", "function"}
SIMPLE_WRAPPERS = {"builtin", "command", "exec", "noglob", "nohup"}
MAX_UNWRAP_DEPTH = 16
RAW_STORAGE_DEVICE_PATTERN = (
    r"/dev/(?:r?disk\d+(?:s\d+)*|sd[a-z]\d*|nvme\d+n\d+(?:p\d+)?|"
    r"mmcblk\d+(?:p\d+)?|loop\d+|vd[a-z]\d*)"
)


@dataclass(frozen=True)
class Decision:
    blocked: bool
    reason: str = ""


def deny(reason: str) -> None:
    print(
        f"BLOCKED by global safety hook: {reason}. "
        "Use a narrower, recoverable operation or ask the user.",
        file=sys.stderr,
    )
    raise SystemExit(2)


def executable_name(token: str) -> str:
    return os.path.basename(token).lower()


def is_assignment(token: str) -> bool:
    return re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*=.*", token, re.DOTALL) is not None


def is_control(token: str) -> bool:
    return bool(token) and all(character in CONTROL_CHARS for character in token)


def is_bare_truncating_redirection(tokens: Sequence[str]) -> bool:
    index = 1 if tokens and tokens[0].isdigit() else 0
    return index + 1 < len(tokens) and tokens[index] in {">", ">|", "&>"}


def tokenize(command: str) -> Tuple[List[List[str]], List[str]]:
    try:
        lexer = shlex.shlex(
            command,
            posix=True,
            punctuation_chars=";&|()<>`\n",
        )
        lexer.whitespace = " \t\r"
        lexer.whitespace_split = True
        lexer.commenters = ""
        tokens = list(lexer)
    except ValueError as exc:
        raise ValueError(f"ambiguous shell syntax: {exc}") from exc

    segments: List[List[str]] = []
    separators: List[str] = []
    current: List[str] = []
    for token in tokens:
        if is_control(token):
            if current:
                segments.append(current)
                current = []
            separators.append(token)
        else:
            current.append(token)
    if current:
        segments.append(current)
    return segments, separators


def consume_wrapper(items: List[str], index: int, wrapper: str) -> int:
    index += 1
    if wrapper in SIMPLE_WRAPPERS:
        if index < len(items) and items[index] == "--":
            index += 1
        return index

    if wrapper == "env":
        value_options = {"-C", "--chdir", "-u", "--unset"}
        while index < len(items):
            token = items[index]
            if token == "--":
                return index + 1
            split_value: Optional[str] = None
            split_length = 0
            if token in {"-S", "--split-string"}:
                if index + 1 >= len(items):
                    return -1
                split_value = items[index + 1]
                split_length = 2
            elif token.startswith("--split-string="):
                split_value = token.split("=", 1)[1]
                split_length = 1
            elif token.startswith("-S") and len(token) > 2:
                split_value = token[2:]
                split_length = 1

            if split_value is not None:
                try:
                    split_items = shlex.split(split_value)
                except ValueError:
                    return -1
                if not split_items:
                    return -1
                items[index : index + split_length] = split_items
                continue

            if token in value_options:
                if index + 1 >= len(items):
                    return -1
                index += 2
                continue
            if is_assignment(token) or token.startswith("-"):
                index += 1
                continue
            return index
        return index

    if wrapper == "time":
        value_options = {"-f", "--format", "-o", "--output"}
        while index < len(items) and items[index].startswith("-"):
            token = items[index]
            index += 1
            if token in value_options and index < len(items):
                index += 1
            if token == "--":
                break
        return index

    if wrapper == "timeout":
        value_options = {"-k", "--kill-after", "-s", "--signal"}
        while index < len(items) and items[index].startswith("-"):
            token = items[index]
            index += 1
            if token in value_options and index < len(items):
                index += 1
            if token == "--":
                break
        if index < len(items):
            index += 1  # duration
        return index

    if wrapper == "stdbuf":
        value_options = {"-e", "--error", "-i", "--input", "-o", "--output"}
        while index < len(items) and items[index].startswith("-"):
            token = items[index]
            index += 1
            if token in value_options and index < len(items):
                index += 1
            if token == "--":
                break
        return index

    return index


def unwrap_command(tokens: Sequence[str]) -> Tuple[Optional[str], List[str]]:
    items = list(tokens)
    index = 0
    unwrap_depth = 0

    while index < len(items):
        while index < len(items) and is_assignment(items[index]):
            index += 1
        if index >= len(items):
            break

        executable = executable_name(items[index])
        if executable in OPAQUE_SHELL_KEYWORDS:
            return "__dynamic_command__", items[index + 1 :]
        if executable in SHELL_FLOW_KEYWORDS:
            index += 1
        elif executable in SIMPLE_WRAPPERS | {"env", "stdbuf", "time", "timeout"}:
            index = consume_wrapper(items, index, executable)
            if index < 0:
                return "__dynamic_command__", []
        else:
            break

        unwrap_depth += 1
        if unwrap_depth > MAX_UNWRAP_DEPTH:
            return "__dynamic_command__", []

    if index >= len(items):
        return None, []

    executable = items[index]
    if "$" in executable:
        return "__dynamic_command__", items[index + 1 :]
    return executable_name(executable), items[index + 1 :]


def has_short_flag(arguments: Sequence[str], flag: str) -> bool:
    for argument in arguments:
        if argument.startswith("-") and not argument.startswith("--"):
            if flag in argument[1:]:
                return True
    return False


def is_inline_interpreter(executable: str) -> bool:
    return executable in INLINE_INTERPRETERS or re.fullmatch(
        r"python\d+(?:\.\d+)*", executable, re.IGNORECASE
    ) is not None


def shell_payload(arguments: Sequence[str]) -> Optional[str]:
    for index, argument in enumerate(arguments):
        if argument.startswith("-") and not argument.startswith("--") and "c" in argument[1:]:
            if index + 1 >= len(arguments):
                return ""
            return arguments[index + 1]
    return None


def inline_payload(arguments: Sequence[str]) -> Optional[str]:
    for option in ("-c", "-e"):
        if option in arguments:
            index = list(arguments).index(option)
            if index + 1 >= len(arguments):
                return ""
            return arguments[index + 1]
    return None


def git_subcommand(arguments: Sequence[str]) -> Tuple[Optional[str], List[str]]:
    value_options = {"-C", "-c", "--config-env", "--git-dir", "--namespace", "--work-tree"}
    index = 0
    while index < len(arguments):
        token = arguments[index]
        if token == "--":
            index += 1
            break
        if token in value_options:
            index += 2
            continue
        if any(token.startswith(option + "=") for option in value_options if option.startswith("--")):
            index += 1
            continue
        if token.startswith("-"):
            index += 1
            continue
        return token.lower(), list(arguments[index + 1 :])
    if index < len(arguments):
        return arguments[index].lower(), list(arguments[index + 1 :])
    return None, []


def check_git(arguments: Sequence[str]) -> Decision:
    for index, argument in enumerate(arguments):
        if argument in {"-c", "--config-env"} and index + 1 < len(arguments):
            if arguments[index + 1].lower().startswith("alias."):
                return Decision(True, "git alias configuration can hide a destructive command")
        if argument.lower().startswith("--config-env=alias."):
            return Decision(True, "git alias configuration can hide a destructive command")

    subcommand, rest = git_subcommand(arguments)
    if subcommand == "reset" and "--hard" in rest:
        return Decision(True, "git reset --hard discards tracked work")
    if subcommand == "clean" and ("--force" in rest or has_short_flag(rest, "f")):
        return Decision(True, "git clean with force deletes untracked files")
    if subcommand == "branch":
        deletes = "-D" in rest or "--delete" in rest or has_short_flag(rest, "d")
        forces = "-D" in rest or "--force" in rest or has_short_flag(rest, "f")
        if deletes and forces:
            return Decision(True, "forced git branch deletion removes a branch without merge checks")
    if subcommand == "checkout" and (
        "--force" in rest
        or has_short_flag(rest, "f")
        or any(any(character in argument for character in "*?[") for argument in rest)
    ):
        return Decision(True, "git checkout force or glob can discard worktree changes")
    if subcommand in {"checkout", "restore"} and "." in rest:
        return Decision(True, f"git {subcommand} on the whole worktree discards changes")
    if subcommand == "config" and any(
        argument.lower().startswith("alias.") for argument in rest
    ):
        return Decision(True, "git alias configuration can hide a destructive command")
    if subcommand == "push":
        force_flags = {"-f", "--force", "--force-with-lease", "--mirror", "--delete"}
        if force_flags.intersection(rest) or any(
            argument.startswith("--force-with-lease=") for argument in rest
        ):
            return Decision(True, "force, mirror, or delete git push can rewrite remote history")
        if any(argument.startswith(":") and len(argument) > 1 for argument in rest):
            return Decision(True, "delete-ref git push can remove a remote branch or tag")
    if subcommand == "reflog" and "expire" in rest:
        return Decision(True, "git reflog expire can remove recovery history")
    if subcommand == "gc" and any(argument.startswith("--prune") for argument in rest):
        return Decision(True, "git gc --prune can remove recovery objects")
    if subcommand == "update-ref" and "-d" in rest:
        return Decision(True, "git update-ref -d deletes a reference")
    if subcommand == "filter-branch":
        return Decision(True, "git filter-branch rewrites repository history")
    return Decision(False)


def check_inline_payload(executable: str, payload: str) -> Decision:
    destructive = re.compile(
        r"(?:shutil\.rmtree|os\.(?:remove|unlink|rmdir)|pathlib[^\n]*\.(?:unlink|rmdir)\s*\(|"
        r"(?:rmSync|rmdirSync|unlinkSync)\s*\(|FileUtils\.rm_rf|"
        r"\b(?:(?:subprocess\.)?(?:run|call|popen)|system|exec|spawn)\s*\(.*?"
        rf"(?:\brm\b.*?(?:--recursive|-[A-Za-z]*[Rr][A-Za-z]*)|\bdiskutil\b|"
        rf"\bdd\b.*?\bof\s*=\s*{RAW_STORAGE_DEVICE_PATTERN})|"
        r"\b(?:exec|eval|compile)\s*\([^\n]*(?:b64decode|base64|fromhex|decode64))",
        re.IGNORECASE | re.DOTALL,
    )
    if destructive.search(payload):
        return Decision(True, f"destructive filesystem operation inside {executable} inline code")
    return Decision(False)


def check_segment(tokens: Sequence[str], depth: int) -> Decision:
    if is_bare_truncating_redirection(tokens):
        return Decision(True, "bare shell redirection would truncate a file without recovery")

    executable, arguments = unwrap_command(tokens)
    if executable is None:
        return Decision(False)
    if executable == "__dynamic_command__":
        return Decision(True, "dynamic shell command cannot be safely classified")
    if executable in {">", ">|", "&>"} and arguments:
        return Decision(True, "bare shell redirection would truncate a file without recovery")
    if executable == "sudo":
        return Decision(True, "sudo privilege escalation is not allowed for agents")
    if executable in {"eval", "source"} or executable == ".":
        return Decision(True, f"{executable} can hide a second-stage command")

    if executable in SHELLS:
        payload = shell_payload(arguments)
        if payload is not None:
            if not payload:
                return Decision(True, f"{executable} -c is missing a classifiable payload")
            return inspect_command(payload, depth + 1)
        if (
            any(argument in {"<", "<<", "<<<", "-"} or argument.startswith("<<") for argument in arguments)
            or has_short_flag(arguments, "s")
        ):
            return Decision(True, f"{executable} reading commands from stdin cannot be safely classified")

    if executable == "rm":
        if (
            "--recursive" in arguments
            or has_short_flag(arguments, "r")
            or has_short_flag(arguments, "R")
        ):
            return Decision(True, "recursive rm is a mass-deletion operation")
        if any(any(character in argument for character in "*?[") for argument in arguments):
            return Decision(True, "wildcard rm can delete an unbounded set of files")
        operands = [
            argument
            for argument in arguments
            if argument != "--" and not argument.startswith("-") and argument not in {">", ">>"}
        ]
        if len(operands) >= 10:
            return Decision(True, "rm with ten or more explicit targets is a mass-deletion operation")
        if any(argument in {"/", ".", "..", "~", "$HOME", "${HOME}"} for argument in operands):
            return Decision(True, "rm targets a root, home, or whole-directory path")

    if executable == "find":
        if "-delete" in arguments:
            return Decision(True, "find -delete can remove an unbounded file set")
        for index, argument in enumerate(arguments):
            if argument in {"-exec", "-execdir", "-ok", "-okdir"}:
                payload = arguments[index + 1 :]
                if any(executable_name(token) in {"rm", "rmdir", "unlink"} for token in payload):
                    return Decision(True, "find executing a delete command is a mass-deletion operation")

    if executable == "xargs" and any(
        executable_name(argument) in {"rm", "rmdir", "unlink"} for argument in arguments
    ):
        return Decision(True, "xargs feeding a delete command can remove an unbounded file set")

    if executable == "rsync" and any(
        argument == "--del" or argument.startswith("--delete") for argument in arguments
    ):
        return Decision(True, "rsync --delete can remove a broad destination file set")

    if executable == "git":
        return check_git(arguments)

    if executable == "diskutil":
        normalized = {argument.lower() for argument in arguments}
        destructive = {
            "apfsdeletecontainer",
            "apfsdeletevolume",
            "deletedisk",
            "deletevolume",
            "erasedisk",
            "erasevolume",
            "partitiondisk",
            "secureerase",
            "zerodisk",
        }
        if normalized.intersection(destructive) or (
            "apfs" in normalized and normalized.intersection({"deletecontainer", "deletevolume"})
        ):
            return Decision(True, "diskutil destructive operation can erase storage")

    if executable == "dd" and any(
        re.fullmatch(rf"of={RAW_STORAGE_DEVICE_PATTERN}", argument, re.IGNORECASE)
        for argument in arguments
    ):
        return Decision(True, "dd raw-disk output can erase storage")
    if executable in {"fdisk", "gdisk", "mkfs"} or executable.startswith("mkfs.") or executable.startswith("newfs_"):
        return Decision(True, f"{executable} can format or repartition storage")
    if executable == "gpt" and any(argument.lower() == "destroy" for argument in arguments):
        return Decision(True, "gpt destroy can erase a partition map")
    if executable == "asr" and "--erase" in arguments:
        return Decision(True, "asr restore --erase can overwrite a volume")

    if executable in {"chmod", "chown"} and (
        "--recursive" in arguments or has_short_flag(arguments, "R")
    ):
        return Decision(True, f"recursive {executable} can damage a broad filesystem tree")

    if executable in {"halt", "poweroff", "reboot", "shutdown"}:
        return Decision(True, f"{executable} disrupts or stops the machine")
    if executable == "kill" and any(argument in {"-1", "--", "0"} for argument in arguments):
        return Decision(True, "broad kill target can terminate many processes")

    if is_inline_interpreter(executable):
        payload = inline_payload(arguments)
        if payload is None and ("-" in arguments or "<<" in arguments):
            payload = " ".join(arguments)
        if payload is not None:
            if not payload:
                return Decision(True, f"{executable} inline mode is missing a classifiable payload")
            decision = check_inline_payload(executable, payload)
            if decision.blocked:
                return decision

    if executable == "osascript" and "-e" in arguments:
        index = list(arguments).index("-e")
        if index + 1 < len(arguments):
            payload = arguments[index + 1]
            if re.search(r"(?:do\s+shell\s+script|\bdelete\b|\berase\b)", payload, re.IGNORECASE):
                return Decision(True, "AppleScript payload can execute or perform destructive operations")

    return Decision(False)


def inspect_command(command: str, depth: int = 0) -> Decision:
    if depth > MAX_RECURSION_DEPTH:
        return Decision(True, "nested command depth exceeds the safety limit")
    if len(command.encode("utf-8")) > MAX_COMMAND_BYTES:
        return Decision(True, "command exceeds the safety inspection size limit")
    if re.search(r":\s*\(\s*\)\s*\{[^}]*:\s*\|[^}]*:\s*&", command, re.DOTALL):
        return Decision(True, "shell fork bomb can exhaust machine resources")
    if re.search(
        r"\b(?:node|nodejs|perl|php|python(?:\d+(?:\.\d+)*)?|ruby)\b[^\n]*(?:<<|<<<)",
        command,
        re.IGNORECASE,
    ):
        decision = check_inline_payload("inline interpreter", command)
        if decision.blocked:
            return decision

    try:
        segments, separators = tokenize(command)
    except ValueError as exc:
        return Decision(True, str(exc))

    for segment in segments:
        decision = check_segment(segment, depth)
        if decision.blocked:
            return decision

    for index, separator in enumerate(separators):
        if "|" not in separator or index + 1 >= len(segments):
            continue
        left, _ = unwrap_command(segments[index])
        right, _ = unwrap_command(segments[index + 1])
        if left in {"curl", "wget", "pbpaste", "ssh"} and right in SHELLS:
            return Decision(True, f"{left} output piped directly into {right} executes unreviewed code")

    if re.search(r"\b(?:bash|sh|zsh)\s+<\s*\(\s*(?:curl|wget)\b", command, re.IGNORECASE):
        return Decision(True, "remote script process substitution executes unreviewed code")
    if re.search(rf"(?:>|>>|\btee\b)\s*{RAW_STORAGE_DEVICE_PATTERN}\b", command, re.IGNORECASE):
        return Decision(True, "raw-disk redirection can erase storage")
    if re.search(r"(?:^|[;&|])\s*:\s*>|\bcat\s+/dev/null\s*>", command, re.IGNORECASE):
        return Decision(True, "shell redirection would truncate a file without recovery")
    if re.search(r"\btruncate\b[^;&|\n]*(?:--size(?:=|\s+)0|-s\s*0)(?:\s|$)", command):
        return Decision(True, "truncate to zero would erase file contents")

    return Decision(False)


def main() -> None:
    try:
        raw_event = sys.stdin.buffer.read(MAX_EVENT_BYTES + 1)
        if len(raw_event) > MAX_EVENT_BYTES:
            raise ValueError("hook event exceeds the safety inspection size limit")
        event = json.loads(raw_event)
        command = event["tool_input"]["command"]
        if not isinstance(command, str) or not command.strip():
            raise ValueError("missing command")
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        deny(f"could not safely parse the tool request ({exc})")

    decision = inspect_command(command)
    if decision.blocked:
        deny(decision.reason)


if __name__ == "__main__":
    main()
