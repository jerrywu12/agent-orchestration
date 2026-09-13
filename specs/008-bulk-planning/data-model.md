# Data model

No persistent schema changes. Ticket.version/projectId/stageId/ownerId govern admission. Launch-intent/history remain server-owned.

Transient batch: captured Ticket[] (1–100), ownerId, preview/submitting/finished phase, per-ticket excluded/submitting/started/queued/launch-failed/refused/uncertain result, reason/admitted flag. One-shot synchronous ref; no saved authorization/remount replay.

Drag snapshot is in-memory tickets. Custom MIME is only a gesture marker. Drop opens preview.
