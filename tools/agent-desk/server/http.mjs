import http from "node:http";
import {
  readFileSync,
  existsSync,
  statSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { resolve, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { homedir } from "node:os";
import { Store, fail, id } from "./store.mjs";
import { Service } from "./service.mjs";
import { Runner } from "./runner.mjs";
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};
const equal = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
const loopback = (address) =>
  ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address);
function identity() {
  let sha = "unavailable";
  try {
    sha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: appRoot,
      encoding: "utf8",
      timeout: 1000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    try {
      sha = JSON.parse(
        readFileSync(join(appRoot, "build-info.json"), "utf8"),
      ).sha;
    } catch {}
  }
  return {
    status: "ok",
    root: appRoot,
    sha,
    version: "1.0.0",
    storage: "ready",
  };
}
async function body(req) {
  if (!/^application\/json\b/i.test(req.headers["content-type"] ?? ""))
    fail(415, "CONTENT_TYPE", "Use application/json.");
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 1024 * 1024)
      fail(413, "BODY_TOO_LARGE", "Request is too large.");
  }
  try {
    const value = JSON.parse(raw || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error();
    return value;
  } catch {
    fail(400, "INVALID_JSON", "Expected a JSON object.");
  }
}
export function createAppServer({
  service,
  runner,
  adminToken = "",
  agentTokens = {},
  allowedHost = "",
  syncManager = null,
}) {
  const sessions = new Map();
  const clients = new Set();
  const loginAttempts = new Map();
  service.on("change", () => {
    for (const res of clients) res.write(`event: change\ndata: {}\n\n`);
  });
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    );
    const json = (value, status = 200) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(value));
    };
    try {
      const host = req.headers.host ?? "";
      let hostname;
      try {
        hostname = new URL(`http://${host}`).hostname;
      } catch {
        fail(403, "HOST", "Invalid host.");
      }
      if (
        !["127.0.0.1", "localhost", "[::1]"].includes(hostname) &&
        host !== allowedHost
      )
        fail(403, "HOST", "Host is not configured.");
      const origin = req.headers.origin;
      if (origin) {
        let originHost;
        try {
          originHost = new URL(origin).host;
        } catch {
          fail(403, "ORIGIN", "Invalid origin.");
        }
        if (originHost !== host)
          fail(403, "ORIGIN", "Cross-origin requests are not allowed.");
      }
      const url = new URL(req.url, `http://${host}`);
      const path = url.pathname;
      const method = req.method;
      let actor = null;
      const bearer = req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.slice(7)
        : null;
      if (bearer) {
        if (adminToken && equal(bearer, adminToken)) actor = { role: "admin" };
        else {
          const agent = Object.entries(agentTokens).find(([, token]) =>
            equal(token, bearer),
          );
          if (agent) actor = { role: "agent", agentId: agent[0] };
          else fail(401, "UNAUTHORIZED", "Invalid credential.");
        }
      }
      const cookie = (req.headers.cookie ?? "")
        .split(";")
        .map((x) => x.trim())
        .find((x) => x.startsWith("agent_desk_session="))
        ?.slice("agent_desk_session=".length);
      if (!actor && cookie) {
        const session = sessions.get(cookie);
        if (session && session > Date.now()) actor = { role: "admin" };
        else sessions.delete(cookie);
      }
      if (!actor && !adminToken && loopback(req.socket.remoteAddress))
        actor = { role: "admin" };
      if (path === "/api/health") {
        service.store.db.prepare("SELECT 1").get();
        return json(identity());
      }
      if (path === "/api/login" && method === "POST") {
        const key = req.socket.remoteAddress;
        const attempt = loginAttempts.get(key);
        if (attempt && attempt.count >= 10 && Date.now() - attempt.at < 60000)
          fail(
            429,
            "LOGIN_RATE_LIMIT",
            "Too many login attempts. Try again in a minute.",
          );
        const input = await body(req);
        if (!adminToken || !equal(input.token, adminToken)) {
          loginAttempts.set(key, {
            count: (attempt?.count ?? 0) + 1,
            at: Date.now(),
          });
          fail(401, "UNAUTHORIZED", "Invalid administrator token.");
        }
        loginAttempts.delete(key);
        const session = randomBytes(32).toString("hex");
        sessions.set(session, Date.now() + 12 * 3600000);
        res.setHeader(
          "Set-Cookie",
          `agent_desk_session=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${process.env.AGENT_DESK_HTTPS === "1" ? "; Secure" : ""}`,
        );
        return json({ ok: true });
      }
      if (path.startsWith("/api/")) {
        if (!actor) fail(401, "UNAUTHORIZED", "Sign in to Agent Desk.");
        if (path === "/api/logout" && method === "POST") {
          if (cookie) sessions.delete(cookie);
          res.setHeader(
            "Set-Cookie",
            "agent_desk_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
          );
          return json({ ok: true });
        }
        if (path === "/api/state" && method === "GET") {
          const state = service.state();
          state.capabilities.localMode = !adminToken;
          if (actor.role === "agent") {
            state.tickets = state.tickets.filter(
              (t) => t.ownerId === actor.agentId,
            );
            const ids = new Set(state.tickets.map((t) => t.id));
            const projects = new Set(state.tickets.map((t) => t.projectId));
            state.activity = state.activity.filter((a) => ids.has(a.ticketId));
            state.projects = state.projects.filter((p) => projects.has(p.id));
            state.stages = state.stages.filter((s) =>
              projects.has(s.projectId),
            );
            state.sync = [];
          }
          return json(state);
        }
        if (path === "/api/events" && method === "GET") {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            Connection: "keep-alive",
          });
          res.write(": connected\n\n");
          clients.add(res);
          const keep = setInterval(() => res.write(": heartbeat\n\n"), 20000);
          keep.unref();
          req.on("close", () => {
            clients.delete(res);
            clearInterval(keep);
          });
          return;
        }
        const parts = path.split("/").filter(Boolean);
        const [, resource, key, action] = parts;
        if (
          actor.role === "agent" &&
          !(
            (resource === "tickets" && action === "claim") ||
            (resource === "executions" && action === "events")
          )
        )
          fail(
            403,
            "AGENT_SCOPE",
            "Agent credentials can only claim assigned work and report their own execution.",
          );
        const input = ["POST", "PATCH", "PUT"].includes(method)
          ? await body(req)
          : {};
        if (resource === "tickets" && action === "claim" && method === "POST") {
          if (actor.role === "agent" && input.agentId !== actor.agentId)
            fail(
              403,
              "AGENT_SCOPE",
              "Agent identity does not match credential.",
            );
          return json(service.claim(key, { ...input, external: true }), 201);
        }
        if (
          resource === "executions" &&
          action === "events" &&
          method === "POST"
        ) {
          if (actor.role === "agent" && input.agentId !== actor.agentId)
            fail(
              403,
              "AGENT_SCOPE",
              "Agent identity does not match credential.",
            );
          return json(service.event(key, input));
        }
        if (
          resource === "executions" &&
          action === "reconcile" &&
          method === "POST"
        )
          return json(service.reconcileExternal(key, input));
        if (resource === "projects" && !key && method === "POST")
          return json(service.createProject(input), 201);
        if (resource === "projects" && key && !action && method === "PATCH")
          return json(service.updateProject(key, input));
        if (resource === "stages" && !key && method === "POST")
          return json(service.createStage(input), 201);
        if (resource === "stages" && key && method === "PATCH")
          return json(service.updateStage(key, input));
        if (resource === "stages" && key && method === "DELETE")
          return json(service.deleteStage(key));
        if (resource === "tickets" && !key && method === "POST")
          return json(service.createTicket(input), 201);
        if (resource === "tickets" && key && !action && method === "PATCH")
          return json(service.updateTicket(key, input));
        if (resource === "tickets" && key && !action && method === "GET")
          return json(service.getTicket(key));
        if (resource === "tickets" && action === "start" && method === "POST")
          return json(runner.start(key), 201);
        if (resource === "tickets" && action === "stop" && method === "POST")
          return json(runner.stop(key));
        if (resource === "tickets" && action === "handoff" && method === "POST")
          return json(service.handoff(key, input));
        if (
          resource === "tickets" &&
          action === "comments" &&
          method === "POST"
        )
          return json(service.comment(key, input), 201);
        if (resource === "agents" && key && method === "PATCH")
          return json(service.updateAgent(key, input));
        if (resource === "integrations" && method === "GET")
          return json({
            github: syncManager
              ? await syncManager.check()
              : {
                  available: false,
                  error: "GitHub connector is not configured.",
                },
            agents: runner.availability(),
            migration: service.store.get("migration", "kangentic") ?? {
              state: "not_imported",
            },
          });
        if (resource === "projects" && action === "sync" && method === "POST") {
          if (!syncManager)
            fail(503, "SYNC_UNAVAILABLE", "GitHub sync is unavailable.");
          return json(syncManager.enqueueProject(key, input), 202);
        }
        if (
          resource === "tickets" &&
          action === "publish" &&
          method === "POST"
        ) {
          if (!syncManager)
            fail(503, "SYNC_UNAVAILABLE", "GitHub sync is unavailable.");
          return json(await syncManager.publish(key));
        }
        if (
          resource === "tickets" &&
          action === "resolve" &&
          method === "POST"
        ) {
          if (!syncManager)
            fail(503, "SYNC_UNAVAILABLE", "GitHub sync is unavailable.");
          return json(syncManager.resolve(key, input.choice));
        }
        fail(404, "NOT_FOUND", "API route not found.");
      }
      if (!["GET", "HEAD"].includes(method))
        fail(405, "METHOD", "Method not allowed.");
      const asset = resolve(appRoot, "dist", "." + decodeURIComponent(path));
      const dist = join(appRoot, "dist");
      if (asset !== dist && !asset.startsWith(dist + "/"))
        fail(403, "PATH", "Invalid asset path.");
      let file = asset;
      if (!existsSync(file) || !statSync(file).isFile())
        file = join(dist, "index.html");
      if (!existsSync(file)) {
        res.writeHead(503, { "Content-Type": "text/plain" });
        return res.end("Agent Desk frontend is not built. Run npm run build.");
      }
      res.writeHead(200, {
        "Content-Type": mime[extname(file)] ?? "application/octet-stream",
      });
      res.end(method === "HEAD" ? undefined : readFileSync(file));
    } catch (e) {
      if (!res.headersSent)
        json(
          {
            error: {
              code: e.code ?? "INTERNAL_ERROR",
              message: e.status
                ? e.message
                : "The operation failed. Check service availability and configuration.",
            },
          },
          e.status ?? 500,
        );
      else res.end();
    }
  });
  server.on("close", () => {
    for (const res of clients) res.end();
  });
  return server;
}
export async function startServer() {
  const host = process.env.AGENT_DESK_HOST ?? "127.0.0.1";
  const port = Number(process.env.AGENT_DESK_PORT ?? 4310);
  const adminToken = process.env.AGENT_DESK_ADMIN_TOKEN ?? "";
  if (!["127.0.0.1", "::1", "localhost"].includes(host) && !adminToken)
    throw Error("Non-loopback binding requires AGENT_DESK_ADMIN_TOKEN.");
  const dataDir = resolve(
    process.env.AGENT_DESK_DATA_DIR ??
      join(homedir(), ".local/share/agent-desk"),
  );
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const tokenPath = join(dataDir, "agent-tokens.json");
  let agentTokens;
  try {
    agentTokens = JSON.parse(readFileSync(tokenPath, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    agentTokens = Object.fromEntries(
      [
        "codex",
        "claude",
        "gemini",
        "cursor",
        "antigravity",
        "hermes",
        "ollama",
        "arkcli",
      ].map((a) => [a, randomBytes(32).toString("hex")]),
    );
    writeFileSync(tokenPath, JSON.stringify(agentTokens), {
      mode: 0o600,
      flag: "wx",
    });
  }
  const store = new Store(join(dataDir, "desk.db"));
  const service = new Service(store);
  const runner = new Runner(service, {
    dataDir,
    url: `http://127.0.0.1:${port}`,
    agentTokens,
  });
  const { SyncManager } = await import("./sync.mjs");
  const syncManager = new SyncManager(service);
  const server = createAppServer({
    service,
    runner,
    adminToken,
    agentTokens,
    allowedHost: process.env.AGENT_DESK_PUBLIC_HOST ?? "",
    syncManager,
  });
  await new Promise((r, reject) => {
    server.once("error", reject);
    server.listen(port, host, r);
  });
  console.log(`Agent Desk listening at http://${host}:${port}`);
  return { server, service, runner, syncManager };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await startServer();
