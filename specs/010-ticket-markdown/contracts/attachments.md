# HTTP contract

Administrator only; existing scoped agents may continue GET assigned ticket/attachment/download.

POST /api/tickets/:id/attachments
Request: {version: positive integer, attachmentIds: string[1..5]}.
Response: 200 full ticket detail with metadata attachments and attachmentContext.
Atomic maximum five combined; validate all IDs and hashes before any binding. Reject duplicate IDs, duplicate SHA content, expired drafts, foreign-bound IDs. Entirely same-ticket bound IDs are an idempotent replay even if ticket version advanced; no write or second event. Mixed already-bound and new draft selections reject409 ATTACHMENT_BOUND without mutation. Otherwise require current version (409 VERSION_CONFLICT). Preserve all existing ticket fields except version/updatedAt; audit attachment IDs and hashes, never body text.

PATCH /api/attachments/:id
Request: {expectedSha256: 64 lowercase hex characters, text: string}.
Response: 200 full attachment (id,ticketId,name,mediaType,size,sha256,createdAt,warnings,text).
Require existing bound Markdown attachment; draft or other formats reject. Validate nonempty readable text <=200000 JavaScript characters, no malformed Unicode/control characters, UTF-8 <=10MiB and total storage quota. Compare expected SHA atomically (409 ATTACHMENT_CONFLICT). Update stored content+SHA+byte size and ticket version/audit together. Original uploaded filesystem source is never opened by this endpoint. No attachment path accepted.

Existing POST /api/attachments accepts Markdown with the existing draft expiry/upload bounds. Draft DELETE remains unchanged. GET/download reflects the last saved attached copy and always serves download as attachment with nosniff.
