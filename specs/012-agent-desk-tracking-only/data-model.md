# Data Model: Tracking-only Agent Desk

No new database fields are required.

| Record | Relevant state | Rule |
| --- | --- | --- |
| Ticket | `stageId`, `ownerId`, `version`, brief and blockers | Confirmed stage moves change status and assignment only. |
| Execution | Exact ticket, agent and session; reports, heartbeat and release | Created by an independent claim; reports drive visible progress and completion stage. |
| Launch intent | Prior `queued`, `awaiting_claim`, `started`, `failed` | Queued and awaiting-claim records become `cancelled` on startup; historical records remain auditable. |
| Run batch | Historical result rows | Read and recovery paths remain; new submissions are refused. |

The existing readiness and claim transactions still reject stale versions, foreign sessions, overlapping scope and held reservations.
