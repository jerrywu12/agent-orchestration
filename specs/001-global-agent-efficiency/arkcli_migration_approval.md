# ArkCLI compatibility migration: approval required

Status: **Not executed.** The efficiency rollout is installed; the live ArkCLI
check remains blocked. Automatic approval review rejected the proposed persistent
backup of credential-bearing state followed by the CLI's automatic compatibility
migration. No ArkCLI retry or credential-state copy is authorized by this note.

## Exact proposed action

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

## Limitation requiring approval

The local wrapper delegates directly to a native binary; its compatibility
migration implementation has not been inspected. We cannot currently guarantee
that migration leaves `/Users/jerry/.arkcli` unchanged. The verified backup
preserves its pre-invocation bytes; restoring them would be a separate reviewed
action if the native migration changes the source. This uncertainty is why this
artifact is an approval note rather than an executable migration script.

Approval must explicitly cover both the persistent private credential backup
and the native startup migration. Approval of the general efficiency deployment
alone did not satisfy automatic approval review for this action.
