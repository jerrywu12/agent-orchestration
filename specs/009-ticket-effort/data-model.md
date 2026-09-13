# Data Model

Ticket.effort: optional persisted property interpreted as null for historical absence. Valid present values: null, XS, S, M, L, XL. Create defaults null; patch omission preserves existing value; explicit null clears. Public reads always include effort. No label interpretation, new SQL table or automatic migration.
