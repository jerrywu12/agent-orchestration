# AGENT-3: resolve the folder-selection acceptance deadlock

## Explicit implementation amendment, 2026-09-13

The user requires an owner to resolve AGENT-3, not leave it indefinitely blocked. The original product outcome is choosing an existing project folder and inspecting/reusing its repository without mutations. The native macOS dialog was an implementation choice, and its unverified completion conflicts with the user's no-computer-control verification policy.

Replace that mechanism rather than waive its test: **Choose folder opens the in-app server-folder browser on every platform.** The actual browser uses the real filesystem listing and inspection services. No native chooser remains reachable in the supported workflow. The legacy native POST returns immediate `409 PICKER_UNAVAILABLE` with instructions to use the in-app chooser; its compatibility capability is false. It never opens an OS dialog. Existing clients receive an explicit fallback instead of hanging.

This supersedes native-folder-dialog wording in US3, FR04, API/UI contracts, tasks and the old remaining-native acceptance note. Chrome standalone installation remains supported and was independently verified through its installed bundle metadata. Native selection is not claimed tested: it is replaced by a supported mechanism with direct end-to-end proof.

## Acceptance and bounded plan

1. Choose folder shows server directories without a native POST, host unlock or OS permission. Navigate parent/child, select current folder, inspect canonical repository metadata and reuse an existing project.
2. Cancel/close preserves form input. Closing during a pending directory listing or inspection releases busy state and fences late responses. Reopen/retry remains usable.
3. Invalid/inaccessible paths report errors. No clone/init/checkout, hidden executor launch or project creation occurs on selection/cancel. Existing repository state stays intact.
4. Preserve authenticated/admin folder API boundaries and bounded listings. Legacy native endpoint retires immediately; never call an OS chooser even if a stale client requests it.
5. RED API/DOM tests precede the narrow replacement. Full Node/DOM/build, independent exact-head review, required CI, merge and installed-runtime selection/inspection/cancel/reuse proof precede Done.

Scope: FolderPicker UI, folder service and compatibility route, focused API/DOM fixtures, README and spec004. No workflow scheduler, review bypass, other ticket mutations or native computer control.

## Pre-edit diagnosis

- Observed failure: screenshot and live AGENT-3 version6 show In review with no active executor and a native-check acceptance hold. Earlier owner review verified 4 folder tests, 10 intake DOM tests, PR21 merge ancestry and installed Chrome registration, but could not exercise the native dialog under current policy.
- Identity: installed `/Users/jerry/.local/share/agent-desk/app`, SHA85d0afee5cc75a6fd46c8b3a6eace2ba5e41ee29. Fix `/private/tmp/agent-3-folder-picker`, branch `codex/agent-3-in-app-folder-picker`, same base. Old execution35dfe8fd is released; new exact claimed executiona53fb70b owns this amendment.
- Trace: Create project -> FolderPicker.nativePick -> POST/project-folder/pick -> osascript choose folder (90s) -> inspectProjectFolder -> canonical path/metadata -> form. The in-app browser already reaches the same inspection boundary through GET/project-folders and POST/projects/inspect without the OS dependency.
- Hypothesis 1: implementation is missing/unmerged. Disproved by merged PR21 ancestry and current passing intake checks.
- Hypothesis 2: review cannot complete because its native mechanism requires disallowed interaction. Proven by exact ticket acceptance and nativeChoose subprocess boundary. Replacement removes this dependency while retaining the product outcome.
- Adjacent lifecycle risk: Close browser only hides the panel; the pending operation can still apply late data and retain busy state. Regression must exercise held listing/inspection and close before completion.
- Test matrix: service/API compatibility retirement and authorization; component pending/cancel/stale ordering; real filesystem navigation/inspection/dedup; invalid path and retries; current-build DOM and merged-runtime identity. No external provider/cache changes; native computer control is intentionally outside the replacement.

## Pre-release verification

- Pre-fix UI RED: Choose folder did not expose Server folder browser (`run-8ec8bwb7.log`). Backend RED: native selection still executed/returned success instead of retired409.
- Build/typecheck passed (`run-m36wihyq.log`). Full Node suite311 passed (`run-4noomq1c.log`); compatibility-copy refinement additionally passed7 focused tests, including old-client Browse server guidance.
- Intake DOM13 passed (`run-3g_rne42.log`); full DOM138 passed (`run-cgtg8nef.log`). Held browse/inspection cancel immediately and ignore late responses; retry/reopen, form preservation, selection metadata and existing-project reuse pass without native calls.
- Independent draft source review found no must-fix findings. Final exact-head review/CI and installed real-filesystem selection proof are recorded on the delivery PR and canonical AGENT-3; these are required before Done.
