# Verification record

## Before implementation
Source: /private/tmp/agent-desk-markdown-specs, codex/ticket-markdown-specs, f0b8e47529306bb85234446ff0ff816a62c10db3. Installed /api/health reports root /Users/jerry/.local/share/agent-desk/app and same SHA. Synthetic processDocument({name:'synthetic-spec.md',bytes:'# Full spec...'}) rejects unsupported_type. Service has no attachDocuments method. SMARTSTO-43,45,49,50 each have zero attachments at ticket version2.

Trace: source Kangentic backlog attachment metadata -> importer copyPending -> no local attachment BLOB -> ticket attachment metadata/context empty -> detail Documents absent. Upload route delegates to document processor, which rejects Markdown extensions. Binding exists only during create; existing tickets cannot repair missing files. Reader only exposes up to10000 extracted characters. These are independent missing boundaries, not filesystem loss or a stale UI build.

Hypotheses checked: (1) originals deleted disproved by all six recorded paths existing with matching recorded sizes; known Downloads copies byte-identical. (2) files attached but hidden disproved by GET ticket and empty attachmentContext on exact live build. (3) direct upload sufficient disproved by unsupported_type and absent append method. No source-document instructions were followed.

Risk matrix: processor unit, BLOB quota/persistence, HTTP auth/contracts, optimistic concurrency, component polling/dismissal, DOM rendering/interaction and installed API verification apply. Market providers/caches and strategy math N/A: only reference documents and ticket UI change. Source originals remain read-only. Agent execution and ownership are preserved; no automatic launch.

Pre-edit synthetic regression run: five tests fail as expected against f0b8e475 (unsupported_type, absent attachDocuments/updateMarkdown, Markdown HTTP422 instead of201). Full private log run-o1fuanl4.log. Six private operational tests pass: restore/edit/rerun, lost-response replay with an intervening edit, and description/history/same-length-text/truncated-extraction detection. The independent reviewer approved the revised restoration script.

## Implementation and delivery
Pending shared scope release, source tests, independent review, merge, runtime cutover and eight verified reattachments.
