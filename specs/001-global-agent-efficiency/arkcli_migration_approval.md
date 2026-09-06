# ArkCLI approved backup and startup verification

**Status: backup and live adapter verification completed on 2026-09-06 UTC.** The user explicitly approved the linked private backup/compatibility operation, then renewed the same account's expired SSO login when authentication reported an invalid refresh token.

## Observed result

- Private backup: `/Users/jerry/.local/state/agent-efficiency/arkcli-migration-backups/approved-auik8wnc/original`.
- 21 regular files, 869,484 bytes. Backup directories are mode `0700`; copied files and manifests are `0600`. Content hashes and timestamps were verified. No credential content was printed or committed.
- Original source and backup remained unchanged after the help invocation and initial authentication diagnosis. The subsequent user-performed login refresh legitimately renewed operational authentication state; the recovery copy preserves the earlier bytes.
- Native `+chat --help` exited 0. The anticipated `~/.arkcli-bytecloud` directory was not created. The normal authentication and live inference paths worked with existing `~/.arkcli` state; no separate state move was forced or claimed.
- After renewed sign-in, `auth status` exited 0 with `logged_in: true`, SSO authentication and active API key status. Identifying and credential fields were suppressed.
- Installed `agent-advice --provider arkcli` returned `READY` using the existing default model `glm-5.3`, with a 512-output-token cap: 70 prompt tokens, 3 completion tokens, 73 total. The adapter neither switched profiles/models nor executed generated tools.

The one-off procedure passed a disposable fake-binary test and an independent read-only security review before execution. That review covered preservation and verification, not the native binary's internal migration implementation. An initial completion heuristic expected a new directory; because none was created, the result was investigated rather than mislabeled as a completed storage migration.

The private generation also contains `manifest.json` and `result.json`. Machine-local diagnostic summaries are `/private/tmp/arkcli-auth-verification-result.json` and `/private/tmp/efficiency-arkcli-live-smoke.json`. Keep the credential-bearing backup private; do not copy it into repository evidence or send it to an adviser.

## Approved operation scope

1. Recheck `/Users/jerry/.arkcli` and the destination
   `/Users/jerry/.arkcli-bytecloud` without invoking ArkCLI. Stop if the source is
   absent, the destination already exists, or either path is a symlink. Stop if
   the source contains symlinks, special files, or changes during inspection.
2. Create one uniquely named backup directory beneath
   `/Users/jerry/.local/state/agent-efficiency/arkcli-migration-backups/` with mode
   `0700`. Copy the original tree without following symlinks; restrict copied
   files and the verification manifest to `0600`. Refuse symlinked parent paths,
   destination collisions, and overwriting. This backup **contains credentials**
   and remains on this Mac until the user explicitly requests its removal.
3. Compare source and backup file hashes and metadata, then recheck the complete
   source tree for concurrent changes. Stop before invoking ArkCLI if the backup
   differs or the source changed. This comparison detects changes; it cannot
   promise an atomic snapshot of another process's actively changing state.
4. Invoke only the installed native binary's `+chat --help`, with a finite
   timeout and these per-command environment overrides:

   ```text
   ARKCLI_NO_UPDATE_NOTIFIER=1
   ARKCLI_CALLER_TYPE=ai_agent
   ARKCLI_CALLER_NAME=codex
   ARKCLI_SKILL_NAME=arkcli-chat
   /Users/jerry/.local/lib/node_modules/@volcengine/ark-cli/bin/arkcli-darwin-arm64 +chat --help
   ```

   This is a help request, not a model request. **The binary may nevertheless
   migrate credential-bearing state during startup.** No authentication,
   profile-switching, skill installation, or model invocation is included.
5. Verify the original tree and backup against their pre-invocation hashes.
   Report only success/failure, file counts, private backup location and exit
   status; never print credential contents or raw CLI diagnostics. If the source
   moved, disappeared or changed, stop and preserve the backup and resulting
   state. Do not automatically restore, delete, merge or overwrite either tree.

## Original uncertainty and approval rationale

The local wrapper delegates directly to a native binary; its compatibility
migration implementation has not been inspected. We cannot currently guarantee
that migration leaves `/Users/jerry/.arkcli` unchanged. The verified backup
preserves its pre-invocation bytes; restoring them would be a separate reviewed
action if the native migration changes the source. This uncertainty is why this
artifact is an approval note rather than an executable migration script.

The user's subsequent explicit approval covered both the persistent private credential backup and native startup migration if performed by the CLI. General installation approval alone had not satisfied the automatic tool-permission review. That approval boundary is now resolved; this record preserves why the earlier action stopped.
