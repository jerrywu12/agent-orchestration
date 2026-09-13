# Verification quickstart

From tools/agent-desk with locked Node22 dependencies: npm test; npm run build; npm run test:e2e. Use agent-run for verbose output. Playwright uses temporary database and synthetic files; never point mutation tests at the installed service.

Open an existing synthetic ticket, choose Attach files, upload a .md, and confirm attachment. Open the file, read a formatted heading/table/end marker, Edit, change source, Preview and Save. Reopen/download to confirm complete saved text. In another API client save a competing revision; the original editor must retain draft and offer explicit reload after conflict. Escape/backdrop with unsaved text must require discard. Confirm unsafe links/raw HTML are inert and images cause no remote requests. Repeat at320px and with a200000-character document. Leave originals unchanged.
