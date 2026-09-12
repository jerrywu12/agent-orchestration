# Acceptance commands
From tools/agent-desk: npm ci; npm test; npm run build; npm run test:e2e.
Start using npm start (default loopback port 4310); GET /api/health proves source identity.
The CLI provides migration preview/apply and connector commands; see app README once implemented.
Repository gates: Python 3.13 unittest discovery for agent-efficiency and agent-guardrails,
bash -n scripts/*.sh and install.sh, fresh-project install/doctor with no FAIL, git diff --check.
Required journeys: persisted CRUD/custom stages; concurrent claim and late event rejection;
GitHub pull/push/conflict/retry; duplicate migration; foreign-origin/agent-auth rejection;
real browser navigation at desktop/mobile widths with clean console; live cutover reconciliation.
