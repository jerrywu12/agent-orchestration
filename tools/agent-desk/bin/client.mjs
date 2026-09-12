import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
export function clientConfig(agentId = process.env.AGENT_DESK_AGENT_ID) {
  let token = process.env.AGENT_DESK_TOKEN ?? "";
  if (!token && agentId) {
    try {
      token =
        JSON.parse(
          readFileSync(
            join(
              process.env.AGENT_DESK_DATA_DIR ??
                join(homedir(), ".local/share/agent-desk"),
              "agent-tokens.json",
            ),
            "utf8",
          ),
        )[agentId] ?? "";
    } catch {}
  }
  const url = process.env.AGENT_DESK_URL ?? "http://127.0.0.1:4310";
  const parsed = new URL(url);
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password
  )
    throw Error("Invalid Agent Desk URL.");
  if (
    parsed.protocol === "http:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
  )
    throw Error("Remote Agent Desk connections require HTTPS.");
  return { url: url.replace(/\/$/, ""), token, agentId };
}
export async function request(method, path, value, config = clientConfig()) {
  if (value === undefined && ["POST", "PATCH", "PUT"].includes(method))
    value = {};
  if (!path.startsWith("/api/") || path.includes("://"))
    throw Error("Only Agent Desk API paths are accepted.");
  const response = await fetch(config.url + path, {
    method,
    headers: {
      ...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
      ...(value !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(value !== undefined ? { body: JSON.stringify(value) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!response.ok) {
    const error = Error(
      result.error?.message ?? `Agent Desk returned ${response.status}`,
    );
    error.code = result.error?.code;
    error.status = response.status;
    throw error;
  }
  return result;
}
