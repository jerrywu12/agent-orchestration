# Data model

Existing attachments table retains id,ticket_id,name,media_type,byte_size,sha256,extracted_text,warnings,page_count,original,created_at,expires_at. No schema change. Draft -> bound remains one-way. Only bound Markdown text/bytes/hash/size can change. SHA is the compare-and-swap token. Ticket record version and updatedAt advance on append/edit without changing stage, owner, claims or brief. Events record IDs/hashes, never document text. AttachmentContext includes full current text; state responses retain metadata only.
