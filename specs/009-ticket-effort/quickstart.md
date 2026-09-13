# Verification Journey

From `tools/agent-desk`, run `npm test`, `npm run build`, `npm run test:e2e`. Browser tests use only the synthetic isolated server. Create an XS ticket, edit to XL, clear to Unset, and reload each value. Compare intentionally unordered XS/S/M/L/XL/Unset tickets using the effort filter and ascending/descending order in list and board. Inspect separate labels and metadata after changes. Restart persistence is covered by closing/reopening an isolated SQLite fixture. No live board write or server restart here.
