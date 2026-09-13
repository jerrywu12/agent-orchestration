# Design Decisions

Ticket data is already stored as JSON in `records`; adding a nullable property avoids a destructive schema migration. Service decoration is the common outward read boundary; normalization there preserves historic raw records. GitHub sync fields are title, description, labels and state, so effort stays local. MCP mutations use agentUpdate/createSubtask and must retain exact session restrictions. Effort filter/sort applies to WorkView filtered tickets before existing stage grouping. No external research or new dependencies needed.
