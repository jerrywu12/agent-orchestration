import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const data = mkdtempSync(join(tmpdir(), "agent-desk-e2e-"));
process.env.AGENT_DESK_DATA_DIR = data;
process.env.AGENT_DESK_PORT = "4318";
process.env.AGENT_DESK_HOST = "127.0.0.1";
process.env.AGENT_DESK_ADMIN_TOKEN = "";
const { startServer } = await import("../server/http.mjs");
const { server, service, syncManager } = await startServer({
  machineOptions: {
    auto: false,
    discover: async () => ({
      agents: [],
      libraries: [],
      sources: [],
      issues: [],
      truncated: false,
    }),
    probe: async () => ({
      host: {
        name: "Browser fixture",
        platform: "fixture",
        arch: "test",
        memoryTotalBytes: 0,
        memoryFreeBytes: 0,
        loadAverage: [],
        uptimeSeconds: 0,
      },
      agents: {},
      services: [],
      issues: [],
      processError: null,
    }),
  },
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    clearInterval(syncManager?.timer);
    server.closeAllConnections();
    server.close(() => {
      service.store.close();
      rmSync(data, { recursive: true, force: true });
      process.exit(0);
    });
  });
