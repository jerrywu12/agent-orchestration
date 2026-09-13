# Research and source observations

Kangentic importer server/migrate.mjs retained attachment metadata with copyPending but did not transfer bytes. Six source-mapped files still exist; two supporting Downloads DOCX files have clear content matches. Four affected tickets have no attachments. Largest full Markdown source is148160 characters; three exceed100000. Private evidence/manifests stay outside the repository.

Current document-processor.mjs accepts TXT/DOC/DOCX/PDF only. HTTP supports draft upload and binding during ticket create but no existing-ticket append. Attachments SQLite stores original bytes, SHA and text, so edits can use SHA for optimistic concurrency without a schema migration. Existing previews stop at10000chars. Service Store transactions support atomic document and ticket updates.

Use react-markdown AST-to-React rather than dangerous HTML insertion; remark-gfm adds tables/task lists. Official references: https://github.com/remarkjs/react-markdown and https://github.com/remarkjs/remark-gfm. Disable raw HTML/images, constrain URL protocols, use synthetic security DOM fixtures. Keep complete editor source separate from render state and ticket polling.

Hermes advisory recommends compare-and-swap races, max-five races, retry/deduplication, retained drafts and source-file hash checks. Filesystem symlink advice does not apply to BLOB storage/API uploads. DeerFlow returned provider HTTP400; no advice relied upon.
