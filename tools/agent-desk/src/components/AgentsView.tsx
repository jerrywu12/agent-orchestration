import { useState } from "react";
import { Bot, Check, CircleDot, ExternalLink, RefreshCw } from "lucide-react";
import { api, errorMessage, pathId } from "../api";
import type { Agent, DeskState, Integrations } from "../types";
import { useAgentCapacity } from "../useAgentCapacity";
import { AgentCapacity } from "./AgentCapacity";
import {
  AgentAvatar,
  ErrorNotice,
  isActive,
  isStale,
  ticketKey,
  timeAgo,
} from "./shared";

export function AgentsView({
  state,
  integrations,
  integrationError,
  refresh,
  refreshIntegrations,
  onOpen,
}: {
  state: DeskState;
  integrations: Integrations | null;
  integrationError: string;
  refresh: () => Promise<void>;
  refreshIntegrations: () => Promise<void>;
  onOpen: (id: string) => void;
}) {
  const capacity = useAgentCapacity();
  return (
    <div className="standard-page agents-page">
      <div className="standard-heading">
        <div className="page-kicker">WORKSPACE / PEOPLE & MACHINES</div>
        <h1>Agents</h1>
        <p>
          Independent executors, shared context. Assign work first, then start a
          session.
        </p>
      </div>
      <div className="section-title agent-list-title">
        <h2>
          Connected agents <span className="count">{state.agents.length}</span>
        </h2>
        <div className="agent-status-actions">
          <button
            className="button small-button"
            onClick={() => void refreshIntegrations()}
          >
            <RefreshCw size={13} /> Check launchers
          </button>
          <button
            className="button small-button"
            disabled={
              capacity.loading || (capacity.refreshing && !capacity.error)
            }
            onClick={() => void capacity.refresh()}
          >
            <RefreshCw size={13} />{" "}
            {capacity.loading || (capacity.refreshing && !capacity.error)
              ? "Refreshing limits…"
              : "Refresh limits"}
          </button>
        </div>
      </div>
      {integrationError && <ErrorNotice>{integrationError}</ErrorNotice>}
      {capacity.error && (
        <ErrorNotice>
          {capacity.error} Retained observations may be stale.
        </ErrorNotice>
      )}
      <div className="agent-list">
        {state.agents.map((agent) => (
          <AgentRow
            key={agent.id}
            agent={agent}
            state={state}
            integration={integrations?.agents.find(
              (item) => item.id === agent.id,
            )}
            refresh={refresh}
            onOpen={onOpen}
            capacity={capacity}
          />
        ))}
      </div>
      <div className="quiet-note">
        <Bot size={16} />
        <p>
          Launcher readiness only checks the server’s configured adapters.
          Provider limits are separate passive observations, refreshed every
          five minutes or on request; this page checks cached status every 30
          seconds. A passed reset time does not confirm recovery. External
          agents can report progress through the API or MCP connector. Enabling
          an agent does not launch it.
        </p>
      </div>
    </div>
  );
}
function AgentRow({
  agent,
  state,
  integration,
  refresh,
  onOpen,
  capacity,
}: {
  agent: Agent;
  state: DeskState;
  integration?: Integrations["agents"][number];
  refresh: () => Promise<void>;
  onOpen: (id: string) => void;
  capacity: ReturnType<typeof useAgentCapacity>;
}) {
  const [name, setName] = useState(agent.name);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const assigned = state.tickets.filter(
    (ticket) => ticket.ownerId === agent.id && !ticket.archived,
  );
  const reserved = assigned.filter((ticket) => isActive(ticket.execution));
  const external = agent.adapter === "external";
  async function update(fields: Partial<Agent>) {
    setBusy(true);
    setError("");
    try {
      await api(`/agents/${pathId(agent.id)}`, "PATCH", fields);
      await refresh();
      setEditing(false);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="agent-row">
      <div className="agent-row-heading">
        <AgentAvatar agent={agent} />
        <div className="agent-identity">
          {editing ? (
            <form
              className="inline-name-form"
              onSubmit={(event) => {
                event.preventDefault();
                void update({ name: name.trim() });
              }}
            >
              <input
                aria-label={`Name for ${agent.id}`}
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <button
                aria-label="Save agent name"
                className="icon-button"
                disabled={busy || !name.trim()}
              >
                <Check size={14} />
              </button>
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  setName(agent.name);
                  setEditing(false);
                }}
              >
                Cancel
              </button>
            </form>
          ) : (
            <h3>
              {agent.name}
              <button
                className="text-button rename-agent"
                onClick={() => setEditing(true)}
              >
                Rename
              </button>
            </h3>
          )}
          <span className="muted small">
            {external
              ? "External reporting"
              : `${agent.adapter || agent.id} · local adapter`}
          </span>
        </div>
        <span
          className={`availability ${!agent.enabled ? "muted" : integration?.available ? "available" : "unavailable"}`}
        >
          <span className="live-dot" />
          {!agent.enabled
            ? "Disabled"
            : integration
              ? integration.available
                ? external
                  ? "External reporting"
                  : "Launcher ready"
                : external
                  ? "External"
                  : "Launcher unavailable"
              : "Checking…"}
        </span>
        <label className="switch-label">
          <span className="sr-only">Enable {agent.name}</span>
          <input
            type="checkbox"
            role="switch"
            checked={agent.enabled}
            disabled={busy}
            onChange={(event) => void update({ enabled: event.target.checked })}
          />
          <span className="switch-track" />
        </label>
      </div>
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <div className="agent-row-body">
        <span>{assigned.length} assigned</span>
        <span>
          <CircleDot size={12} />
          {reserved.length} reserved
        </span>
        {integration?.reason && (
          <span className="agent-reason">{integration.reason}</span>
        )}
      </div>
      <AgentCapacity
        capacity={capacity.agents.find((item) => item.agentId === agent.id)}
        name={agent.name}
        loading={capacity.loading}
        failed={!!capacity.error}
        now={capacity.checkedAt}
      />
      {reserved.length > 0 && (
        <div className="agent-sessions">
          {reserved.map((ticket) => (
            <button key={ticket.id} onClick={() => onOpen(ticket.id)}>
              <span className="ticket-id">
                {ticketKey(ticket, state.projects)}
              </span>
              <span>{ticket.title}</span>
              <span
                className={isStale(ticket.execution) ? "warning-text" : "muted"}
              >
                {isStale(ticket.execution)
                  ? "Stale heartbeat"
                  : timeAgo(ticket.execution?.heartbeatAt)}
              </span>
              <ExternalLink size={12} />
            </button>
          ))}
        </div>
      )}
    </article>
  );
}
