import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Activity,
  ArrowUpRight,
  Bot,
  ChevronDown,
  Folder,
  Layers3,
  ListTodo,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  Settings2,
  SquareStack,
  X,
} from "lucide-react";
import { api, errorMessage, pathId } from "./api";
import { useDesk } from "./useDesk";
import type { Page, Ticket } from "./types";
import { ActivityFeed } from "./components/ActivityFeed";
import { AgentsView } from "./components/AgentsView";
import { CreateProject, CreateTicket } from "./components/CreateDialogs";
import { SettingsView } from "./components/SettingsView";
import { TicketDetails } from "./components/TicketDetails";
import { WorkView } from "./components/WorkView";
import { ErrorNotice, timeAgo } from "./components/shared";

const navigation = [
  { id: "work", title: "All work", icon: ListTodo },
  { id: "activity", title: "Activity", icon: Activity },
  { id: "agents", title: "Agents", icon: Bot },
  { id: "settings", title: "Settings", icon: Settings2 },
] as const;

export default function App() {
  const desk = useDesk();
  const { state } = desk;
  const [page, setPage] = useState<Page>("work");
  const [projectId, setProjectId] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [create, setCreate] = useState<"project" | "ticket" | null>(null);
  const [createStage, setCreateStage] = useState<string | undefined>();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [actionError, setActionError] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  function newTicket(stageId?: string) {
    setCreateStage(stageId);
    setCreate(state?.projects.length ? "ticket" : "project");
  }
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement;
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        element?.closest('input,textarea,select,[contenteditable="true"]') ||
        document.querySelector("dialog[open]") ||
        desk.authRequired ||
        !state
      )
        return;
      if (event.key === "/" && page === "work") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        newTicket();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [page, state?.projects.length, desk.authRequired]);
  useEffect(() => {
    if (
      state &&
      projectId &&
      !state.projects.some((project) => project.id === projectId)
    )
      setProjectId("");
  }, [state?.projects, projectId]);
  async function updateTicket(ticket: Ticket, fields: Partial<Ticket>) {
    setActionError("");
    try {
      await api(`/tickets/${pathId(ticket.id)}`, "PATCH", {
        version: ticket.version,
        ...fields,
      });
      await desk.refresh();
    } catch (failure) {
      setActionError(errorMessage(failure));
      await desk.refresh();
    }
  }
  function navigate(next: Page, project = projectId) {
    setPage(next);
    setProjectId(project);
    setSidebarOpen(false);
    setActionError("");
  }
  const selectedTicket = state?.tickets.find(
    (ticket) => ticket.id === selectedId,
  );
  if (desk.authRequired) return <Login onLogin={desk.login} />;
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      {sidebarOpen && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside
        className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}
        aria-label="Main navigation"
      >
        <div className="brand">
          <span className="brand-icon">
            <SquareStack size={18} strokeWidth={1.8} />
          </span>
          <span>
            Agent Desk
            <span className="brand-subtitle">YOUR WORK, IN MOTION</span>
          </span>
          <button
            className="icon-button mobile-close"
            aria-label="Close navigation"
            onClick={() => setSidebarOpen(false)}
          >
            <X size={16} />
          </button>
        </div>
        <button
          className="workspace-switch"
          onClick={() => navigate("settings")}
        >
          <span className="workspace-icon">
            <Layers3 size={15} />
          </span>
          <span>
            My workspace
            <small>
              {state?.capabilities.localMode === false
                ? "Private server"
                : "Local workspace"}
            </small>
          </span>
          <ChevronDown size={13} />
        </button>
        <nav className="primary-nav">
          {navigation.map((item) => (
            <button
              key={item.id}
              className={
                page === item.id && (item.id !== "work" || !projectId)
                  ? "nav-item active"
                  : "nav-item"
              }
              onClick={() =>
                navigate(item.id, item.id === "work" ? "" : projectId)
              }
              aria-current={
                page === item.id && (item.id !== "work" || !projectId)
                  ? "page"
                  : undefined
              }
            >
              <item.icon size={16} />
              <span>{item.title}</span>
              {item.id === "work" && state && (
                <span className="nav-count">
                  {state.tickets.filter((ticket) => !ticket.archived).length}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-section-title">
          <span>Projects</span>
          <button
            className="icon-button"
            aria-label="Create project"
            onClick={() => setCreate("project")}
            disabled={!state}
          >
            <Plus size={14} />
          </button>
        </div>
        <nav className="project-nav" aria-label="Projects">
          {state?.projects.map((project) => (
            <button
              key={project.id}
              className={`nav-item project-nav-item ${projectId === project.id && page === "work" ? "active" : ""}`}
              onClick={() => navigate("work", project.id)}
              aria-current={
                projectId === project.id && page === "work" ? "page" : undefined
              }
            >
              <span className="project-glyph">
                {project.key?.slice(0, 2) || <Folder size={12} />}
              </span>
              <span title={project.name}>{project.name}</span>
              <span className="nav-count">
                {
                  state.tickets.filter(
                    (ticket) =>
                      ticket.projectId === project.id && !ticket.archived,
                  ).length
                }
              </span>
            </button>
          ))}
          {state && !state.projects.length && (
            <p className="sidebar-empty">Your projects will appear here.</p>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="workspace-health">
            <span
              className={`live-dot ${desk.error ? "warning-dot" : !state ? "quiet" : ""}`}
            />
            <span>
              {desk.error
                ? "Connection interrupted"
                : state
                  ? "Workspace connected"
                  : "Connecting…"}
            </span>
            {desk.error && (
              <button
                className="icon-button"
                aria-label="Reconnect"
                onClick={() => void desk.refresh()}
              >
                <RefreshCw size={12} />
              </button>
            )}
          </div>
          <div className="sidebar-footnote">
            <span>
              {desk.lastUpdated
                ? `Updated ${timeAgo(new Date(desk.lastUpdated).toISOString())}`
                : "Self-hosted · your data"}
            </span>
            <span className="version-label">
              {desk.health?.version
                ? `v${desk.health.version.replace(/^v/, "")}`
                : "Agent Desk"}
            </span>
          </div>
          {state?.capabilities.localMode === false && (
            <button
              className="text-button logout"
              onClick={() =>
                void desk
                  .logout()
                  .catch((failure) => setActionError(errorMessage(failure)))
              }
            >
              <LogOut size={13} />
              Sign out
            </button>
          )}
        </div>
      </aside>
      <main className="main-content" id="main-content">
        <div className="mobile-topbar">
          <button
            className="icon-button"
            aria-label="Open navigation"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={20} />
          </button>
          <span>
            <SquareStack size={16} />
            Agent Desk
          </span>
          <button
            className="icon-button"
            aria-label="New ticket"
            onClick={() => newTicket()}
            disabled={!state}
          >
            <Plus size={18} />
          </button>
        </div>
        {desk.error && (
          <div className="connection-banner" role="alert">
            <span>
              {state ? "Showing the last received data. " : ""}
              {desk.error}
            </span>
            <button className="text-button" onClick={() => void desk.refresh()}>
              <RefreshCw size={13} />
              Retry
            </button>
          </div>
        )}
        {actionError && (
          <div className="action-error">
            <ErrorNotice>{actionError}</ErrorNotice>
            <button
              className="icon-button"
              aria-label="Dismiss error"
              onClick={() => setActionError("")}
            >
              <X size={15} />
            </button>
          </div>
        )}
        {!state ? (
          <div
            className="loading-page"
            aria-busy="true"
            aria-label="Loading workspace"
          >
            <div className="loading-heading" />
            <div className="loading-toolbar" />
            {Array.from({ length: 7 }, (_, i) => (
              <div className="loading-row" key={i} />
            ))}
            <span className="sr-only">Loading workspace…</span>
          </div>
        ) : page === "work" ? (
          <WorkView
            state={state}
            projectId={projectId}
            onOpen={setSelectedId}
            onCreate={newTicket}
            onCreateProject={() => setCreate("project")}
            onUpdate={updateTicket}
            searchRef={searchRef}
          />
        ) : page === "activity" ? (
          <div className="standard-page">
            <div className="standard-heading">
              <div className="page-kicker">WORKSPACE / CHANGELOG</div>
              <h1>Activity</h1>
              <p>
                The latest updates across tickets, agents, and connected
                projects.
              </p>
            </div>
            <div className="activity-filter">
              <label>
                Project
                <select
                  value={projectId}
                  onChange={(event) => setProjectId(event.target.value)}
                >
                  <option value="">All projects</option>
                  {state.projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
              <span className="muted small">Newest first</span>
            </div>
            <ActivityFeed
              state={state}
              onTicket={setSelectedId}
              items={state.activity.filter(
                (item) =>
                  !projectId ||
                  state.tickets.some(
                    (ticket) =>
                      ticket.id === item.ticketId &&
                      ticket.projectId === projectId,
                  ),
              )}
            />
          </div>
        ) : page === "agents" ? (
          <AgentsView
            state={state}
            integrations={desk.integrations}
            integrationError={desk.integrationError}
            refresh={desk.refresh}
            refreshIntegrations={desk.refreshIntegrations}
            onOpen={setSelectedId}
          />
        ) : (
          <SettingsView
            key={projectId}
            state={state}
            projectId={projectId}
            health={desk.health}
            integrations={desk.integrations}
            refresh={desk.refresh}
            onCreateProject={() => setCreate("project")}
          />
        )}
      </main>
      {create === "project" && (
        <CreateProject
          onClose={() => setCreate(null)}
          onCreated={async (project) => {
            await desk.refresh();
            setCreate(null);
            navigate("work", project.id);
          }}
        />
      )}
      {create === "ticket" && state && (
        <CreateTicket
          state={state}
          projectId={projectId || undefined}
          stageId={createStage}
          onClose={() => setCreate(null)}
          onCreated={async (ticket) => {
            await desk.refresh();
            setCreate(null);
            setSelectedId(ticket.id);
          }}
        />
      )}
      {selectedTicket && state && (
        <TicketDetails
          key={selectedTicket.id}
          ticket={selectedTicket}
          state={state}
          integrations={desk.integrations}
          onClose={() => setSelectedId(null)}
          refresh={desk.refresh}
          onOpen={setSelectedId}
        />
      )}
    </div>
  );
}

function Login({ onLogin }: { onLogin: (token: string) => Promise<void> }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onLogin(token);
      setToken("");
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <div className="login-brand">
        <span className="brand-icon">
          <SquareStack size={22} />
        </span>
        Agent Desk
      </div>
      <form className="login-panel" onSubmit={submit}>
        <LockKeyhole size={23} />
        <h1>Welcome to your workspace</h1>
        <p>Enter your server access token to connect.</p>
        {error && <ErrorNotice>{error}</ErrorNotice>}
        <label>
          Access token
          <input
            type="password"
            required
            autoFocus
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
        </label>
        <button className="button primary" disabled={busy || !token.trim()}>
          {busy ? (
            <LoaderCircle size={15} className="spin" />
          ) : (
            <ArrowUpRight size={15} />
          )}
          {busy ? "Connecting…" : "Open workspace"}
        </button>
        <span className="field-hint">
          Your token is used to sign in and is never saved in browser storage.
        </span>
      </form>
      <p className="login-footer">
        Self-hosted. A shared desk for independent agents.
      </p>
    </main>
  );
}
