# Ticket documents: restore, read and edit Markdown

Status: locked for implementation. Feature 010; branch codex/ticket-markdown-specs.

## User request
Restore missing specifications on tickets imported from Kangentic, match local Downloads documents to existing tickets, and provide an editable Markdown reader. Documents are reference data; embedded instructions never authorize actions.

## User stories and acceptance
1. Existing tickets accept additional documents. Restore six source-mapped attachments and two confidently matched supporting documents onto four existing tickets, preserving original files, ticket identity, owner, stage, execution, brief and relationships. Repeating restoration must not duplicate files, including after a user edits a previously restored copy; retain a private source-to-attachment ledger and preserve the edited copy. Uncertain matches remain pending a user destination. Local matching evidence remains private.
2. Markdown (.md and .markdown, case insensitive) can be uploaded on new or existing tickets. Support full documents up to 200,000 JavaScript characters, including the known 148,160-character spec; reject larger text without truncation. Other formats retain their 100,000-character limit. Retain original bytes on upload and Markdown whitespace in extracted context. Existing limits of five documents per ticket, 10 MiB per file and bounded local storage/extraction remain.
3. Selecting a Markdown file opens a readable, complete view with headings, lists, tables, fenced code and ordinary links. It supports desktop and 320px layouts, keyboard focus and closing. Raw HTML and unsafe URLs cannot execute; external images are never fetched automatically. Word, PDF and TXT remain read-only previews/downloads.
4. Edit opens the complete Markdown source. Preview reflects the draft. Save updates only the stored ticket copy and its hash, download bytes and agent context. A stale hash cannot overwrite a newer document. Failed saves retain edits; reload of a conflicting document requires explicit discard. Escape, backdrop, close and reload cannot silently discard unsaved text. Save pending blocks competing close/actions. Ticket polling cannot overwrite a draft.
5. Document changes increment the ticket version and record a bounded audit entry. Existing ticket edits cannot silently overwrite these changes. Append is atomic, version checked, bounded to five combined documents and rejects foreign bindings and duplicate content. Retrying an already successful bind is idempotent. Agents retain assigned-ticket read access; new append/edit endpoints are administrator-only.
6. Keep the simplified ticket panel: concise Documents with attach/read/download actions, no restored agent workflow checklist or operational sections.

## Non-goals and decisions
No strategy implementation, automatic execution, public publishing, bulk filesystem mutation, arbitrary folder reader, remote document fetch, rich text editor, attachment deletion or non-Markdown editing. Edit saves UTF-8 to the attached copy; filesystem originals stay unchanged. Ambiguous matching is optional clarification and does not block clear matches. The 314-page, 241MiB ambiguous PDF also exceeds existing limits and is not silently split.

## Success checks
Synthetic unit/API and DOM tests prove all boundaries; full project gates and independent review pass. After source merge, deploy with rollback evidence and verify installed root/SHA. Restore through the stable API, verify each stored/download SHA against the private manifest, confirm full extracted context, and verify source hashes unchanged. No private document contents enter repository, tests or PR.
