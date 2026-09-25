# API and UI Contract

- `POST /api/tickets/:id/transition` with a current version, Planning or Ready stage, enabled owner and `confirmed: true` returns `{ ticket, outcome: "moved" }`. It performs no dispatch.
- `POST /api/tickets/:id/start` and `POST /api/runs` return HTTP 410 with code `TRACKING_ONLY` and create no execution or batch.
- Existing scoped claim, progress event, organization, delivery and read-only execution endpoints remain available.
- Planning and Ready dialogs say they record the assignment. Bulk Planning results say the ticket awaits an agent update. The Run Agent control is absent.
