import { realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { homedir, platform as hostPlatform } from "node:os";
import { fileURLToPath } from "node:url";
import { fail, id } from "./store.mjs";

const loadInventory = (options) =>
  import("./machine-inventory.mjs").then((m) => m.discoverMachine(options));
const loadRuntime = (options) =>
  import("./machine-inventory.mjs").then((m) => m.probeMachine(options));
const unknown = () => ({
  status: "unknown",
  processes: [],
  cpuPercent: null,
  memoryBytes: null,
});
const issues = (values) =>
  (Array.isArray(values) ? values : [])
    .filter((v) => typeof v === "string")
    .slice(0, 50)
    .map((v) => v.slice(0, 320));

// Caches are deliberately memory-only: machine observations never enter ticket
// history, the sync outbox, scoped agent state or persisted execution claims.
export class MachineMonitor {
  constructor(
    service,
    {
      auto = true,
      discover = loadInventory,
      probe = loadRuntime,
      home = homedir(),
      appRoot = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
      platform = hostPlatform(),
      clock = Date.now,
      inventoryIntervalMs = 300000,
      runtimeIntervalMs = 15000,
      scanTimeoutMs = 45000,
      probeTimeoutMs = 8000,
    } = {},
  ) {
    Object.assign(this, {
      service,
      discover,
      probe,
      home,
      appRoot,
      platform,
      clock,
      inventoryIntervalMs,
      runtimeIntervalMs,
      scanTimeoutMs,
      probeTimeoutMs,
    });
    this.inventory = {
      agents: [],
      libraries: [],
      sources: [],
      issues: [],
      truncated: false,
    };
    this.runtime = { host: null, agents: {}, services: [], issues: [] };
    this.inventoryAt = null;
    this.runtimeAt = null;
    this.inventoryAttemptAt = null;
    this.inventoryError = null;
    this.runtimeError = null;
    this.revision = 0;
    this.pending = null;
    this.closed = false;
    this.scanningInventory = false;
    this.inventoryRequested = false;
    this.controllers = new Set();
    if (auto) {
      this.refresh();
      this.timer = setInterval(
        () => this.refresh({ inventory: false }),
        runtimeIntervalMs,
      );
      this.timer.unref();
    }
  }
  customSources() {
    return this.service.store
      .list("machine-source")
      .map(({ id, label, path, version }) => ({ id, label, path, version }));
  }
  snapshot() {
    return {
      host: this.runtime.host,
      agents: this.inventory.agents.map((agent) => ({
        ...agent,
        ...(this.runtime.agents[agent.id] ?? unknown()),
      })),
      libraries: this.inventory.libraries,
      sources: this.inventory.sources,
      services: this.runtime.services,
      customSources: this.customSources(),
      scan: {
        state: this.pending
          ? "scanning"
          : this.inventoryError || this.runtimeError
            ? "error"
            : "idle",
        inventoryAt: this.inventoryAt,
        runtimeAt: this.runtimeAt,
        error: this.inventoryError,
        runtimeError: this.runtimeError,
        issues: issues([...this.inventory.issues, ...this.runtime.issues]),
        truncated: this.inventory.truncated,
      },
      limits: {
        inventoryIntervalMs: this.inventoryIntervalMs,
        runtimeIntervalMs: this.runtimeIntervalMs,
        maxCustomSources: 20,
      },
    };
  }
  async bounded(task, timeout) {
    const controller = new AbortController();
    this.controllers.add(controller);
    let abort;
    const aborted = new Promise((_, reject) => {
      abort = () => reject(Error("Observation cancelled."));
      controller.signal.addEventListener("abort", abort, { once: true });
    });
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      return await Promise.race([task(controller.signal), aborted]);
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener("abort", abort);
      this.controllers.delete(controller);
    }
  }
  refresh({ inventory = true } = {}) {
    if (this.closed) return Promise.resolve();
    if (inventory && !this.scanningInventory) this.inventoryRequested = true;
    if (this.pending) return this.pending;
    this.pending = this.collect()
      .catch(() => {
        if (!this.closed)
          this.inventoryError =
            "Machine observation failed. Last successful data is retained.";
      })
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }
  async collect() {
    do {
      const revision = this.revision;
      const shouldDiscover =
        this.inventoryRequested ||
        this.inventoryAttemptAt === null ||
        this.clock() - this.inventoryAttemptAt >= this.inventoryIntervalMs;
      this.inventoryRequested = false;
      if (shouldDiscover) {
        this.scanningInventory = true;
        this.inventoryAttemptAt = this.clock();
        try {
          const result = await this.bounded(
            (signal) =>
              this.discover({
                home: this.home,
                appRoot: this.appRoot,
                platform: this.platform,
                projects: this.service.store
                  .list("project")
                  .map(({ id, name, path }) => ({ id, name, path })),
                customSources: this.customSources(),
                signal,
              }),
            this.scanTimeoutMs,
          );
          if (this.closed) return;
          // Source changes during slow I/O invalidate the entire observation.
          if (revision !== this.revision) {
            this.inventoryRequested = true;
            continue;
          }
          this.inventory = result;
          this.inventoryAt = new Date(this.clock()).toISOString();
          this.inventoryError = null;
        } catch {
          if (this.closed) return;
          this.inventoryError =
            "Inventory could not be refreshed. Last successful inventory is retained.";
        } finally {
          this.scanningInventory = false;
        }
      }
      if (this.closed) return;
      if (revision !== this.revision) {
        this.inventoryRequested = true;
        continue;
      }
      try {
        const result = await this.bounded(
          (signal) =>
            this.probe({
              agents: this.inventory.agents,
              platform: this.platform,
              signal,
            }),
          this.probeTimeoutMs,
        );
        if (this.closed) return;
        if (revision !== this.revision) {
          this.inventoryRequested = true;
          continue;
        }
        if (result.processError) {
          result.agents = Object.fromEntries(
            this.inventory.agents.map((agent) => [
              agent.id,
              {
                ...(this.runtime.agents[agent.id] ?? unknown()),
                status: "unknown",
              },
            ]),
          );
          this.runtimeError =
            "Process observation is unavailable. Retained process values are stale.";
        } else {
          this.runtimeError = null;
          this.runtimeAt = new Date(this.clock()).toISOString();
        }
        this.runtime = result;
      } catch {
        if (this.closed) return;
        this.runtimeError =
          "Runtime observation failed. Last successful values are retained and stale.";
        this.runtime = {
          ...this.runtime,
          agents: Object.fromEntries(
            Object.entries(this.runtime.agents).map(([key, value]) => [
              key,
              { ...value, status: "unknown" },
            ]),
          ),
        };
      }
    } while (!this.closed && this.inventoryRequested);
  }
  async addSource(input) {
    if (this.closed)
      fail(503, "MONITOR_CLOSED", "Machine monitoring is stopping.");
    const path = input?.path;
    if (
      typeof path !== "string" ||
      path.length > 4096 ||
      !isAbsolute(path) ||
      /[\x00-\x1f\x7f]/.test(path)
    )
      fail(422, "SOURCE_PATH", "Use an existing absolute folder path.");
    const label =
      input.label === undefined
        ? basename(path) || "Library folder"
        : input.label;
    if (
      typeof label !== "string" ||
      !label.trim() ||
      label.trim().length > 80 ||
      /[\x00-\x1f\x7f]/.test(label)
    )
      fail(
        422,
        "SOURCE_LABEL",
        "Use a folder label between 1 and 80 characters.",
      );
    let canonical;
    try {
      canonical = await this.bounded(async () => {
        const target = await realpath(path);
        if (!(await stat(target)).isDirectory()) throw Error();
        return target;
      }, 3000);
    } catch {
      fail(422, "SOURCE_PATH", "That folder does not exist or cannot be read.");
    }
    if (this.closed)
      fail(503, "MONITOR_CLOSED", "Machine monitoring is stopping.");
    // Recheck after asynchronous resolution: concurrent adds must not duplicate.
    const existing = this.customSources();
    if (existing.some((source) => source.path === canonical))
      fail(409, "SOURCE_EXISTS", "This folder is already monitored.");
    if (existing.length >= 20)
      fail(
        422,
        "SOURCE_LIMIT",
        "At most 20 additional library folders can be monitored.",
      );
    const source = this.service.store.put("machine-source", {
      id: id(),
      label: label.trim(),
      path: canonical,
    });
    this.revision++;
    this.inventoryRequested = true;
    this.refresh();
    return source;
  }
  removeSource(key) {
    if (this.closed)
      fail(503, "MONITOR_CLOSED", "Machine monitoring is stopping.");
    const source = this.service.store.get("machine-source", key);
    if (!source)
      fail(404, "SOURCE_NOT_FOUND", "Library folder is no longer configured.");
    this.service.store.delete("machine-source", key);
    // Hide stale custom rows immediately; a fresh scan will restore any roots
    // also discovered through independent registered/global sources.
    const removed = new Set(
      this.inventory.sources
        .filter((s) => s.path === source.path && s.kind === "custom")
        .map((s) => s.id),
    );
    this.inventory = {
      ...this.inventory,
      sources: this.inventory.sources.filter((s) => !removed.has(s.id)),
      libraries: this.inventory.libraries.filter(
        (p) => !removed.has(p.sourceId),
      ),
    };
    this.revision++;
    this.inventoryRequested = true;
    this.refresh();
    return { ok: true };
  }
  close() {
    this.closed = true;
    clearInterval(this.timer);
    for (const controller of this.controllers) controller.abort();
  }
}
